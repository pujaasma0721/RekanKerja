"use client";
// P8-PERF — views dokumen Kinerja Grup 3 (Kualitas & Kepatuhan) + Grup 4 =======
// (Konsekuensi & Analitik). Mirror pola medical/report-documents/report-views-g34.
//
// AUDIT KOLOM (insiden R1.2 payroll & LR3.1): jumlah kolom thead = jumlah sel
// efektif tiap baris tbody; TotalRow spanLabel + cells.length = jumlah kolom.
//   PF31 S 6 (span 6 + 0) · PF31 B 13 (span 5 + 8) ·
//   PF32 B 9 (span 2 + 7) · PF33 B 13 (span 6 + 7) ·
//   PF41 B 16 (span 8 + 8) · PF42 B 13 (span 13 + 0) ·
//   PF43 M 4 (per baris) · PF43 D 7 (span 7 + 0) · PF43 U 5 (span 5 + 0) ·
//   PF44 B 1 + tahun + 1 (TotalRow span 1 + cells per tahun + total).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type {
  DocMeta, PF31Data, PF32Data, PF33Data, PF41Data, PF42Data, PF43Data, PF44Data,
} from "./types";
import { mkDocNo, rp, MaskedBanner, RatingChip, CheckMark } from "./report-views-g12";

/** Flag bias atasan (D19): z≤−1 pelis (skor rendah), z≥+1 royal (skor tinggi). */
const FLAG_LABEL: Record<string, [string, string]> = {
  strictness: ["Terlalu pelis (skor rendah)", "Too strict (low scores)"],
  leniency: ["Terlalu royal (skor tinggi)", "Too lenient (high scores)"],
};

/** Status merit dwibahasa (pf41 — kunci = label ID dari payload). */
const MERIT_STATUS_LABEL: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"],
  "Menunggu Persetujuan": ["Menunggu Persetujuan", "Awaiting Approval"],
  Disetujui: ["Disetujui", "Approved"],
  Ditolak: ["Ditolak", "Rejected"],
  Diterapkan: ["Diterapkan", "Applied"],
  Dibatalkan: ["Dibatalkan", "Cancelled"],
};
/** Status PIP dwibahasa (pf42 — kunci = label ID dari payload). */
const PIP_STATUS_LABEL: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"],
  Aktif: ["Aktif", "Active"],
  Diperpanjang: ["Diperpanjang", "Extended"],
  Pulih: ["Pulih", "Recovered"],
  "Tidak Pulih": ["Tidak Pulih", "Not Recovered"],
  Dibatalkan: ["Dibatalkan", "Cancelled"],
};

// ================= pf31 Jejak Kalibrasi =================
export function PF31View({ data, meta }: { data: PF31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf31" landscape>
      <DocHeader meta={meta} reportNo="F3.1" title={t("Jejak Kalibrasi", "Calibration Audit Trail")} subtitle={t(`Siklus ${data.cycleCode} — setiap keputusan perubahan nilai ter-audit (alasan WAJIB §35-9)`, `Cycle ${data.cycleCode} — every score-change decision is audited (mandatory reason §35-9)`)} audience={t("HR Admin · Direksi · Auditor", "HR Admin · Directors · Auditors")} docNo={mkDocNo("pf31", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Δ skor = Σ (skor baru − skor lama) seluruh keputusan — indikasi arah penyetaraan.", "Score Δ = Σ (new − old) across all decisions — the direction of leveling.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Keputusan", "Decisions"), value: f.num(data.summary.decisions), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sesi", "Sessions"), value: f.num(data.summary.sessions) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Δ Skor Total", "Total Score Δ"), value: `${data.summary.totalScoreDelta >= 0 ? "+" : ""}${data.summary.totalScoreDelta}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Band Potensi Diisi", "Potential Bands Set"), value: f.num(data.rows.filter((r) => r.potentialBand != null).length) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Sesi Kalibrasi", "Calibration Sessions")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Sesi</TH><TH>Ketua</TH><TH align="number">Peserta Forum</TH><TH align="center">Status</TH><TH align="number">Keputusan</TH>
      </>}>
        {data.sessions.map((s, i) => (
          <tr key={s.id} className="hover:bg-slate-50">
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-bold text-slate-800">{s.label}</TD>
            <TD>{s.chair ?? <Dash />}</TD>
            <TD align="number">{f.num(s.participants)}</TD>
            <TD align="center"><DocBadge tone={s.status === "Tertutup" ? "green" : "amber"}>{s.status}</DocBadge></TD>
            <TD align="number" className="font-bold">{f.num(s.decisions)}</TD>
          </tr>
        ))}
        {data.sessions.length === 0 && (
          <tr><TD colSpan={6} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Belum ada sesi kalibrasi.", "No calibration sessions yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.sessions.length} ${t("sesi", "sessions")}`} cells={[]} spanLabel={6} />
      </DocTable>

      <DocSection no="C" title={t("Jejak Keputusan (urut waktu)", "Decision Trail (chronological)")} note={t("Alasan wajib — jejak memenuhi kewajiban audit PP 35/2021 §7.2.", "Reasons are mandatory — the trail satisfies the PP 35/2021 §7.2 audit requirement.")} />
      <div className="doc-scroll max-h-[440px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>Sesi</TH><TH>Ketua</TH><TH>No. Karyawan</TH><TH>Nama</TH>
              <TH align="number">Skor dari</TH><TH align="number">Skor ke</TH><TH align="number">Rating dari</TH>
              <TH align="number">Rating ke</TH><TH align="center">Band</TH><TH>Alasan (WAJIB)</TH><TH>Diputus oleh</TH><TH>Waktu</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="whitespace-nowrap text-[9.5px] font-bold text-slate-700">{r.sessionLabel}</TD>
                <TD className="text-[9.5px]">{r.chair ?? <Dash />}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD align="number">{r.oldScore == null ? <Dash /> : f.num(r.oldScore)}</TD>
                <TD align="number" className="font-black">{r.newScore == null ? <Dash /> : f.num(r.newScore)}</TD>
                <TD align="number">{r.oldRating ?? "—"}</TD>
                <TD align="number" className="font-bold">{r.newRating ?? "—"}</TD>
                <TD align="center">{r.potentialBand ?? "—"}</TD>
                <TD className="max-w-[280px] text-[9px] leading-snug">{r.reason}</TD>
                <TD className="text-[9.5px]">{r.decidedBy}</TD>
                <TD className="whitespace-nowrap">{f.dt(r.decidedAt)}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={13} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada keputusan kalibrasi pada siklus ini.", "No calibration decisions in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.summary.decisions} ${t("keputusan", "decisions")} · Δ ${data.summary.totalScoreDelta >= 0 ? "+" : ""}${data.summary.totalScoreDelta}`} cells={["", "", "", "", "", "", "", ""]} spanLabel={5} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Setiap perubahan skor/rating/band potensi menyimpan alasan, pemutus, dan waktu — tidak ada perubahan senyap.", "Every score/rating/potential-band change stores its reason, decider, and time — no silent changes.")} />
    </ReportSheet>
  );
}

// ================= pf32 Indikator Bias Atasan =================
export function PF32View({ data, meta }: { data: PF32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf32">
      <DocHeader meta={meta} reportNo="F3.2" title={t("Indikator Bias Atasan", "Manager Bias Indicator")} subtitle={t(`Siklus ${data.cycleCode} — statistik penilaian per atasan vs perusahaan (D19)`, `Cycle ${data.cycleCode} — per-manager rating statistics vs company (D19)`)} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf32", meta)} />

      <DocSection no="A" title={t("Statistik Perusahaan", "Company Statistics")} note={t("z = (rata-rata tim − rata-rata perusahaan) / sebaran perusahaan. z ≤ −1 cenderung pelis, z ≥ +1 cenderung royal (amber); |z| ≥ 2 merah. σ tim < ½ σ perusahaan = central tendency.", "z = (team mean − company mean) / company spread. z ≤ −1 lenient-leaning, z ≥ +1 strict-leaning (amber); |z| ≥ 2 red. Team σ < ½ company σ = central tendency.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Penilaian", "Appraisals"), value: f.num(data.company.n), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata", "Mean"), value: f.num(data.company.mean) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sebaran (σ)", "Spread (σ)"), value: f.num(data.company.sigma) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Atasan Ter-flag", "Flagged Managers"), value: f.num(data.summary.flagged) }]} />
      </div>

      <DocSection no="B" title={t("Statistik per Atasan (≥2 bawahan dinilai)", "Per-Manager Statistics (≥2 appraised)")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Atasan Penilai</TH><TH align="number">N</TH><TH align="number">Rata-rata</TH>
        <TH align="number">σ Tim</TH><TH align="number">z</TH><TH>Indikasi</TH><TH align="center">Tingkat</TH><TH align="center">Central Tendency</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.managerId ?? i} className={cn("hover:bg-slate-50", r.flagLevel === "red" && "bg-rose-50/50", r.flagLevel === "amber" && "bg-amber-50/40")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-bold text-slate-800">{r.managerName}</TD>
            <TD align="number">{f.num(r.n)}</TD>
            <TD align="number" className="font-bold">{f.num(r.meanScore)}</TD>
            <TD align="number">{f.num(r.stdDev)}</TD>
            <TD align="number" className={cn("font-black", r.flagLevel === "red" ? "text-red-600" : r.flagLevel === "amber" ? "text-amber-600" : "text-slate-700")}>{r.z == null ? <Dash /> : r.z.toFixed(2)}</TD>
            <TD>{r.flag ? <DocBadge tone={r.flagLevel === "red" ? "red" : "amber"}>{t(...(FLAG_LABEL[r.flag] ?? [r.flag, r.flag]))}</DocBadge> : <span className="text-[9.5px] text-slate-500">{t("Seimbang", "Balanced")}</span>}</TD>
            <TD align="center">{r.flagLevel == null ? <span className="text-slate-300">–</span> : <DocBadge tone={r.flagLevel === "red" ? "red" : "amber"}>{r.flagLevel}</DocBadge>}</TD>
            <TD align="center">{r.centralTendency ? <DocBadge tone="violet">✓ σ tim &lt; ½σ</DocBadge> : <span className="text-slate-300">–</span>}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada atasan dengan ≥2 bawahan dinilai pada siklus ini.", "No manager with ≥2 appraised reports in this cycle yet.")}</TD></tr>
        )}
        <TotalRow label={t("PERUSAHAAN (pembanding z)", "COMPANY (z baseline)")} cells={[
          data.company.n, data.company.mean, data.company.sigma, "", `${data.summary.flagged} ${t("ter-flag", "flagged")}`, "", "",
        ]} spanLabel={2} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Indikator adalah LENSA bukan vonis — koreksi hanya lewat keputusan kalibrasi beralasan (ter-audit). Forced-distribution OFF (D2).", "Indicators are a lens, not a verdict — corrections only via reasoned calibration decisions (audited). Forced distribution OFF (D2).")} />
    </ReportSheet>
  );
}

// ================= pf33 Register Banding =================
export function PF33View({ data, meta }: { data: PF33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf33">
      <DocHeader meta={meta} reportNo="F3.3" title={t("Register Banding", "Appeal Register")} subtitle={t(`Tahun ${data.year} — banding karyawan atas hasil penilaian & keputusannya`, `Year ${data.year} — employee appeals against appraisal results & their decisions`)} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf33", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Jendela banding: appealDays sejak publikasi (default 7 hari — D6).", "Appeal window: appealDays from publication (default 7 days — D6).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Banding", "Total Appeals"), value: f.num(data.summary.appeals), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Disetujui (Adjusted)", "Approved (Adjusted)"), value: f.num(data.summary.adjusted) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Ditolak", "Rejected"), value: f.num(data.summary.rejected) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terbuka", "Open"), value: f.num(data.summary.open) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Banding", "Appeal Register")} note={t("Skor awal = skor pasca-kalibrasi sebelum banding; skor baru terisi bila putusan Disetujui.", "Initial score = post-calibration score before the appeal; the new score is filled when the decision is Approved.")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Siklus</TH>
        <TH align="number">Skor Awal</TH><TH align="center">Rating</TH><TH>Alasan Banding</TH><TH>Tgl Banding</TH>
        <TH align="center">Keputusan</TH><TH align="number">Skor Baru</TH><TH>Diputus oleh</TH><TH>Waktu Putusan</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-mono text-[9.5px] font-bold text-slate-800">{r.docNo}</TD>
            <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{r.fullName}</TD>
            <TD className="font-bold text-slate-700">{r.cycleCode}</TD>
            <TD align="number">{r.score == null ? <Dash /> : f.num(r.score)}</TD>
            <TD align="center"><RatingChip rating={r.rating} label={r.rating != null ? `${r.rating}` : null} /></TD>
            <TD className="max-w-[240px] text-[9px] leading-snug">{r.appealNote}</TD>
            <TD className="whitespace-nowrap">{f.dt(r.appealDate)}</TD>
            <TD align="center">{r.decision ? <DocBadge tone={r.decision.startsWith("Disetujui") ? "green" : r.decision === "Ditolak" ? "red" : "amber"}>{r.decision}</DocBadge> : <Dash />}</TD>
            <TD align="number" className="font-black text-emerald-700">{r.newScore == null ? <Dash /> : f.num(r.newScore)}</TD>
            <TD className="text-[9.5px]">{r.decidedBy ?? <Dash />}</TD>
            <TD className="whitespace-nowrap">{r.decidedAt ? f.dt(r.decidedAt) : "—"}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={13} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada banding pada tahun ini.", "No appeals this year.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.summary.appeals} ${t("banding", "appeals")}`} cells={[
          data.summary.adjusted, data.summary.rejected, data.summary.open, "", "", "", "",
        ]} spanLabel={6} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Putusan Adjusted membuat CalibrationDecision baru (alasan wajib) — jejak lengkap di laporan Jejak Kalibrasi (F3.1).", "An Adjusted decision creates a new CalibrationDecision (mandatory reason) — full trail in the Calibration Audit Trail report (F3.1).")} />
    </ReportSheet>
  );
}

// ================= pf41 Register Merit (vault) =================
export function PF41View({ data, meta }: { data: PF41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf41" landscape>
      <DocHeader meta={meta} reportNo="F4.1" title={t("Register Merit", "Merit Register")} subtitle={t(`Siklus ${data.cycleCode} — usulan bonus & kenaikan gaji hingga jurnal payroll yang menyerap`, `Cycle ${data.cycleCode} — bonus & raise proposals through the absorbing payroll journal`)} audience={t("HR C&B · Finance · Direksi", "HR C&B · Finance · Directors")} docNo={mkDocNo("pf41", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Nominal mengikuti status Brankas Uang (terkunci → •••). Σ null bila ada nominal ter-mask.", "Amounts follow the Money Vault status (locked → •••). Σ is null when any amount is masked.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Usulan", "Proposals"), value: f.num(data.summary.n), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Bonus", "Σ Bonus"), value: rp(data.summary.sumBonus) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Raise", "Σ Raise"), value: rp(data.summary.sumRaise) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Total", "Σ Total"), value: rp(data.summary.sumTotal), accent: true }]} />
      </div>
      {data.masked && <MaskedBanner />}

      <DocSection no="B" title={t("Daftar Usulan Merit", "Merit Proposal Register")} note={t("Approval = jenjang berjalan (tier nominal D12 — L2 Direktur aktif bila total ≥ Rp 10 jt).", "Approval = running tier (amount tier D12 — Director L2 active when total ≥ Rp 10m).")} />
      <div className="doc-scroll max-h-[460px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Usulan</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>No. Penilaian</TH><TH align="center">Rating</TH><TH align="number">Bonus (bln)</TH>
              <TH align="number">Bonus (Rp)</TH><TH align="number">Raise %</TH><TH align="number">Raise (Rp)</TH>
              <TH align="number">Total (Rp)</TH><TH align="center">Status</TH><TH>Approval</TH><TH>Run Payroll</TH><TH align="center">PA</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-800">{r.docNo}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
                <TD className="font-mono text-[9.5px]">{r.appraisalNo}</TD>
                <TD align="center"><RatingChip rating={r.rating} label={r.ratingLabel} /></TD>
                <TD align="number">{r.bonusMonths == null ? <Dash /> : f.num(r.bonusMonths)}</TD>
                <TD align="number">{rp(r.bonusAmount)}</TD>
                <TD align="number">{r.raisePct == null ? <Dash /> : f.num(r.raisePct)}</TD>
                <TD align="number">{rp(r.raiseAmount)}</TD>
                <TD align="number" className="font-black">{rp(r.totalAmount)}</TD>
                <TD align="center"><DocBadge tone={r.status === "Diterapkan" ? "green" : r.status === "Disetujui" ? "sky" : r.status === "Ditolak" ? "red" : "slate"}>{t(...(MERIT_STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD className="text-[9px]">{r.approval ? `L${r.approval.currentLevel}/${r.approval.totalLevels}${r.approval.currentApprover ? ` · ${r.approval.currentApprover}` : ""}` : "—"}</TD>
                <TD className="font-mono text-[9px]">{r.appliedRunNo ?? "—"}</TD>
                <TD align="center">{r.personnelActionId ? <CheckMark v /> : <span className="text-slate-300">–</span>}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={16} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada usulan merit pada siklus ini.", "No merit proposals in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.summary.n} ${t("usulan", "proposals")}`} cells={[
              rp(data.summary.sumBonus), "", rp(data.summary.sumRaise), rp(data.summary.sumTotal), "", "", "", "",
            ]} spanLabel={8} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Bonus diserap payroll lewat run BONUS (assignment Specific); raise permanen lewat PA SalaryAdjustment/Promotion (§32-3).", "Bonuses are absorbed by payroll via BONUS runs (Specific assignments); permanent raises go through PA SalaryAdjustment/Promotion (§32-3).")} />
    </ReportSheet>
  );
}

// ================= pf42 Register PIP & Outcome =================
export function PF42View({ data, meta }: { data: PF42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf42" landscape>
      <DocHeader meta={meta} reportNo="F4.2" title={t("Register PIP & Outcome", "PIP & Outcome Register")} subtitle={t(`Tahun ${data.year} — program perbaikan kinerja 30/60/90 hari & tingkat pemulihan`, `Year ${data.year} — 30/60/90-day performance improvement plans & recovery rate`)} audience={t("HR Admin · Atasan Pembina", "HR Admin · Coaching Managers")} docNo={mkDocNo("pf42", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Tingkat pemulihan = Recovered ÷ program berakhir (Recovered + NotRecovered).", "Recovery rate = Recovered ÷ ended programs (Recovered + NotRecovered).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Program PIP", "PIP Programs"), value: f.num(data.summary.n), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pulih", "Recovered"), value: f.num(data.summary.recovered) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Aktif / Diperpanjang", "Active / Extended"), value: f.num(data.summary.active) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tingkat Pemulihan", "Recovery Rate"), value: data.summary.recoveryRate == null ? "—" : `${data.summary.recoveryRate}%`, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Daftar Program PIP", "PIP Register")} note={t("Checkpoint = capaian per evaluasi (30/60/90 hari); capaian akhir = checkpoint terakhir yang direview.", "Checkpoints = achievement per review (30/60/90 days); last achievement = the latest reviewed checkpoint.")} />
      <div className="doc-scroll max-h-[460px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. PIP</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>Periode</TH><TH align="center">Perpanjang</TH><TH align="number">Sasaran</TH>
              <TH>Checkpoint (capaian)</TH><TH align="number">Capaian Akhir %</TH><TH align="center">Status</TH>
              <TH>Pembina</TH><TH>Catatan Hasil</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.status === "Pulih" && "bg-emerald-50/50", r.status === "Tidak Pulih" && "bg-rose-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-800">{r.docNo}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
                <TD className="whitespace-nowrap">{r.period}</TD>
                <TD align="center">{r.extended ? <DocBadge tone="amber">✓</DocBadge> : <span className="text-slate-300">–</span>}</TD>
                <TD align="number">{f.num(r.targetsCount)}</TD>
                <TD className="text-[9px]">{r.checkpoints}</TD>
                <TD align="number" className={cn("font-black", r.lastReviewPct != null && r.lastReviewPct >= 100 ? "text-emerald-600" : "text-slate-700")}>{r.lastReviewPct == null ? <Dash /> : f.num(r.lastReviewPct)}</TD>
                <TD align="center"><DocBadge tone={r.status === "Pulih" ? "green" : r.status === "Tidak Pulih" ? "red" : r.status === "Aktif" || r.status === "Diperpanjang" ? "amber" : "slate"}>{t(...(PIP_STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD className="text-[9.5px]">{r.reviewer ?? <Dash />}</TD>
                <TD className="max-w-[220px] text-[9px] leading-snug">{r.note ?? "—"}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={13} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada program PIP pada tahun ini.", "No PIP programs this year.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.summary.n} ${t("program", "programs")} · ${t("pulih", "recovered")} ${data.summary.recovered} (${data.summary.recoveryRate == null ? "—" : `${data.summary.recoveryRate}%`})`} cells={[]} spanLabel={13} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("NotRecovered menyarankan SP jenjang riwayat + PA Termination MANUAL melalui modul HR Base (tidak auto-PHK §33-4).", "NotRecovered suggests a tiered warning letter (SP) + MANUAL Termination PA via HR Base (no auto-termination §33-4).")} />
    </ReportSheet>
  );
}

// ================= pf43 Snapshot 9-Box =================
export function PF43View({ data, meta }: { data: PF43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const byPerf = (perf: number) => data.cells.filter((c) => c.perf === perf).sort((a, b) => a.potential - b.potential);
  const perfLabel = (p: number) => p === 3 ? t("Performa Tinggi", "High Performance") : p === 2 ? t("Performa Sedang", "Medium Performance") : t("Performa Rendah", "Low Performance");
  const potLabel = (p: number) => p === 3 ? t("Potensi Tinggi (3)", "High Potential (3)") : p === 2 ? t("Potensi Sedang (2)", "Medium Potential (2)") : t("Potensi Rendah (1)", "Low Potential (1)");
  return (
    <ReportSheet docId="pf43">
      <DocHeader meta={meta} reportNo="F4.3" title={t("Snapshot 9-Box", "9-Box Snapshot")} subtitle={t(`Siklus ${data.cycleCode} — kinerja (rating) × potensi (band kalibrasi)`, `Cycle ${data.cycleCode} — performance (rating) × potential (calibration band)`)} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf43", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Band performa: rating 1–2 rendah, 3 sedang, 4–5 tinggi; band potensi diisi saat kalibrasi (1–3).", "Performance band: ratings 1–2 low, 3 medium, 4–5 high; potential band set during calibration (1–3).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terpetakan", "Placed"), value: f.num(data.totals.placed), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Belum Ber-band", "Unplaced"), value: f.num(data.totals.unplaced) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sel Terisi", "Occupied Cells"), value: f.num(data.cells.filter((c) => c.count > 0).length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sel Terbesar", "Largest Cell"), value: (() => { const m = [...data.cells].sort((a, b) => b.count - a.count)[0]; return m && m.count > 0 ? `${m.label} (${m.count})` : "—"; })() }]} />
      </div>

      <DocSection no="B" title={t("Matriks 9-Box", "9-Box Matrix")} note={t("Baris = performa (rating final), kolom = potensi (band) — klik tidak tersedia di dokumen cetak; detail di tabel C.", "Rows = performance (final rating), columns = potential (band) — details in table C.")} />
      <DocTable head={<>
        <TH>Performa \ Potensi</TH><TH align="center">{potLabel(1)}</TH><TH align="center">{potLabel(2)}</TH><TH align="center">{potLabel(3)}</TH>
      </>}>
        {[3, 2, 1].map((perf) => (
          <tr key={perf} className={cn("hover:bg-slate-50", perf === 3 && "bg-emerald-50/30", perf === 1 && "bg-rose-50/20")}>
            <TD className="font-extrabold text-slate-800">{perfLabel(perf)}</TD>
            {byPerf(perf).map((c) => (
              <TD key={c.potential} align="center" className={cn("py-2.5", c.count > 0 && "font-black")}>
                <span className={cn("block text-[9px] font-bold uppercase tracking-wide", c.count > 0 ? "text-slate-500" : "text-slate-300")}>{c.label}</span>
                <span className={cn("text-[15px] tabular-nums", c.count > 0 ? "text-slate-900" : "text-slate-300")}>{c.count}</span>
                {c.count > 0 && <span className="block text-[8.5px] text-slate-400">{t("orang", "people")}</span>}
              </TD>
            ))}
          </tr>
        ))}
      </DocTable>

      <DocSection no="C" title={t("Detail per Sel", "Per-Cell Detail")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Sel</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="number">Skor Final</TH><TH align="center">Rating</TH>
      </>}>
        {data.cells.flatMap((c) => c.employees.map((e, i) => (
          <tr key={`${c.perf}-${c.potential}-${e.employeeNo}`} className="hover:bg-slate-50">
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="whitespace-nowrap text-[9.5px] font-bold text-slate-700">{c.label} (P{c.perf}×B{c.potential})</TD>
            <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{e.fullName}</TD>
            <TD className="text-[9.5px]">{e.unit ?? <Dash />}</TD>
            <TD align="number" className="font-bold">{e.finalScore == null ? <Dash /> : f.num(e.finalScore)}</TD>
            <TD align="center"><RatingChip rating={e.finalRating} label={`${e.finalRating}`} /></TD>
          </tr>
        )))}
        {data.totals.placed === 0 && (
          <tr><TD colSpan={7} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Belum ada peserta ber-band pada siklus ini.", "No banded participants in this cycle yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.totals.placed} ${t("terpetakan", "placed")}`} cells={[]} spanLabel={7} />
      </DocTable>

      {data.unplaced.length > 0 && (
        <>
          <DocSection no="D" title={t("Belum Terpetakan (tanpa rating atau band)", "Unplaced (no rating or band)")} />
          <DocTable head={<>
            <TH align="center">#</TH><TH>No. Dokumen</TH><TH>Nama</TH><TH align="center">Rating</TH><TH align="center">Band Potensi</TH>
          </>}>
            {data.unplaced.map((u, i) => (
              <tr key={u.docNo} className="hover:bg-slate-50">
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{u.docNo}</TD>
                <TD className="font-semibold text-slate-800">{u.fullName}</TD>
                <TD align="center">{u.finalRating ?? "—"}</TD>
                <TD align="center">{u.potentialBand ?? "—"}</TD>
              </tr>
            ))}
            <TotalRow label={`TOTAL — ${data.totals.unplaced} ${t("belum ber-band", "unplaced")}`} cells={[]} spanLabel={5} />
          </DocTable>
        </>
      )}

      <DocFooter meta={meta} signNote={t("9-box adalah bahan pembicaraan suksesi — bukan keputusan mutlak. Band potensi diisi via keputusan kalibrasi (§5.3).", "The 9-box is succession discussion material — not an absolute decision. Potential bands are set via calibration decisions (§5.3).")} />
    </ReportSheet>
  );
}

// ================= pf44 Tren Kinerja Multi-Tahun per Unit =================
export function PF44View({ data, meta }: { data: PF44Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const avgTone = (v: number | null) => v == null ? "text-slate-300" : v >= 80 ? "text-emerald-600" : v >= 60 ? "text-amber-600" : "text-rose-600";
  return (
    <ReportSheet docId="pf44">
      <DocHeader meta={meta} reportNo="F4.4" title={t("Tren Kinerja Multi-Tahun per Unit", "Multi-Year Performance Trend by Unit")} subtitle={t("Rata-rata skor final per unit lintas tahun siklus + tren perusahaan", "Average final score per unit across cycle years + company trend")} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf44", meta)} />

      <DocSection no="A" title={t("Tren Perusahaan", "Company Trend")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.company.map((c) => (
          <SummaryBox key={c.year} className="grid-cols-1" items={[{ label: String(c.year), value: c.avg == null ? "—" : f.num(c.avg), accent: true }]} />
        ))}
        {data.company.length === 0 && (
          <SummaryBox className="grid-cols-1" items={[{ label: t("Tren", "Trend"), value: "—", accent: true }]} />
        )}
      </div>

      <DocSection no="B" title={t("Tren per Unit (rata-rata skor final · jumlah org)", "Per-Unit Trend (avg final score · headcount)")} note={t("Sel = rata-rata (n org). Warna: ≥80 hijau, 60–79 amber, <60 merah.", "Cell = average (n people). Colors: ≥80 green, 60–79 amber, <60 red.")} />
      <DocTable head={<>
        <TH>Unit Kerja</TH>
        {data.years.map((y) => <TH key={y} align="center">{String(y)}</TH>)}
        <TH align="number">Total Org-Tahun</TH>
      </>}>
        {data.rows.map((r) => (
          <tr key={r.unit} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{r.unit}</TD>
            {r.perYear.map((y) => (
              <TD key={y.year} align="center" className={cn("font-black tabular-nums", avgTone(y.avg))}>
                {y.avg == null ? <span className="text-slate-300">—</span> : (
                  <span>{f.num(y.avg)}<span className="ml-1 text-[8px] font-bold text-slate-400">({y.n})</span></span>
                )}
              </TD>
            ))}
            <TD align="number" className="font-bold">{f.num(r.perYear.reduce((s, y) => s + y.n, 0))}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={data.years.length + 2} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada skor final tercatat.", "No final scores recorded yet.")}</TD></tr>
        )}
        <TotalRow label={t("PERUSAHAAN (semua unit)", "COMPANY (all units)")} cells={[
          ...data.company.map((c) => (c.avg == null ? "—" : f.num(c.avg))),
          f.num(data.company.reduce((s, c) => s + c.n, 0)),
        ]} spanLabel={1} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Hanya peserta ber-skor final yang dihitung. Unit tanpa nilai pada suatu tahun = tidak ada peserta ber-skor tahun itu.", "Only participants with final scores are counted. An empty unit-year means no scored participants that year.")} />
    </ReportSheet>
  );
}
