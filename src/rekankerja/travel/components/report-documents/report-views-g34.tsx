"use client";
// TRAV-1-b — views dokumen Travel Grup 3 (Kepatuhan Kebijakan) + Grup 4 ========
// (Vendor & Logistik). Mirror pola medical/report-documents/report-views-g34.tsx
// (MED-1-b) — komponen dasar dipakai bersama dari doc-kit modul HR.
//
// AUDIT KOLOM (insiden R1.2 payroll & LR3.1): jumlah kolom thead = jumlah sel
// efektif tiap baris tbody; TotalRow spanLabel + cells.length = jumlah kolom.
//   TR31 B 11 kolom (span 7 + 4) · TR31 C 4 (2 + 2)
//   TR32 B 10 (8 + 2) · TR32 C 3 (1 + 2) · TR33 B 10 (4 + 6)
//   TR41 B 12 (5 + 7) · TR41 C 3 (1 + 2)
//   TR42 B 7 (1 + 6) · TR42 D 8 (4 + 4)
//   TR43 B 8 (5 + 3) · TR43 D 7 (6 + 1).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import { mkDocNo, rp, rpNa, sumMoney, TravelDocFooter } from "./report-views-g12";
import { reportById } from "./catalog";
import type { DocMeta, TR31Data, TR32Data, TR33Data, TR41Data, TR42Data, TR43Data } from "./types";

/** Tone badge status klaim settlement (mirror g12). */
const CLAIM_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Draft: "slate", Submitted: "amber", Approved: "sky", Rejected: "red", Cancelled: "slate",
  Transferred: "violet", Paid: "green", Settled: "green",
};
const CLAIM_LABEL: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"], Submitted: ["Menunggu Verifikasi", "Pending Verification"],
  Approved: ["Disetujui", "Approved"], Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
  Transferred: ["Ditransfer", "Transferred"], Paid: ["Dibayar", "Paid"], Settled: ["Selesai", "Settled"],
};

// ================= TR3.1 Travel Tier & Policy Violation Report =================
export function TR31View({ data, meta }: { data: TR31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr31");
  const violationsByCode = data.byCode.reduce((s, c) => s + c.violations, 0);
  return (
    <ReportSheet docId="tr31" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R3.1"} title={def?.titleEn ?? "Travel Tier & Policy Violation Report"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr31", meta)} />

      <DocSection no="A" title={t("Ringkasan Pelanggaran", "Violation Summary")} note={t("Hanya baris biaya dengan plafon > 0 yang nilainya melebihi plafon jenis biaya (limit 0 = tanpa limit, tidak diaudit).", "Only expense lines with a ceiling > 0 whose amount exceeds the expense-type ceiling (limit 0 = unlimited, not audited).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahun Buku", "Fiscal Year"), value: f.num(data.year) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pelanggaran", "Violations"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tetap Disetujui", "Approved Anyway"), value: f.num(data.approvedAnyway) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Nilai Lebih", "Σ Excess"), value: rp(data.sum.excess), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Register Pelanggaran Plafon (urut tanggal klaim)", "Ceiling Violation Register (by claim date)")} note={t("Lebih = nominal − plafon; Over % = lebih ÷ plafon × 100; Tetap Disetujui = pelanggaran yang klaim induknya tetap disetujui atasan.", "Excess = amount − ceiling; Over % = excess ÷ ceiling × 100; Approved Anyway = violations whose parent claim was still approved.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH align="center">Tanggal</TH><TH>Karyawan</TH><TH>Jenis Biaya</TH>
              <TH align="number">Qty</TH><TH align="number">Nominal</TH><TH align="number">Plafon</TH>
              <TH align="number">Lebih</TH><TH align="number">Over %</TH><TH align="center">Status Klaim</TH>
              <TH align="center">Tetap Disetujui</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.claimDocNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.approvedAnyway && "bg-amber-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.claimDocNo}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}{i.unit ? ` · ${i.unit}` : ""}</p>
                  {i.grade && <span className="mt-0.5 inline-block rounded bg-violet-100 px-1 py-px text-[8px] font-bold text-violet-700">{i.grade}</span>}
                </TD>
                <TD>
                  <p className="text-[9.5px] font-bold text-slate-700">{i.typeName}</p>
                  <p className="text-[8.5px] text-slate-400">{i.limitLabel}</p>
                </TD>
                <TD align="number">{f.num(i.qty)}</TD>
                <TD align="number">{rp(i.amount)}</TD>
                <TD align="number">{rp(i.limit)}</TD>
                <TD align="number" className={cn("font-black", (i.excess ?? 0) > 0 && "text-red-600")}>{rp(i.excess)}</TD>
                <TD align="number" className="font-black">{f.pct(i.overPct)}</TD>
                <TD align="center"><DocBadge tone={CLAIM_TONE[i.claimStatus] ?? "slate"}>{t(...(CLAIM_LABEL[i.claimStatus] ?? [i.claimStatusLabel, i.claimStatusLabel]))}</DocBadge></TD>
                <TD align="center">
                  {i.approvedAnyway
                    ? <DocBadge tone="amber">{t("Tetap Disetujui", "Approved Anyway")}</DocBadge>
                    : <span className="text-slate-300">—</span>}
                </TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada pelanggaran plafon tahun ini 🎉", "No ceiling violations this year 🎉")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("pelanggaran", "violations")}`} cells={[
              rp(data.sum.excess), "", "", "",
            ]} spanLabel={7} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Rekap per Kode Biaya", "Recap per Expense Code")} />
      <DocTable head={<>
        <TH>Kode</TH><TH>Jenis Biaya</TH><TH align="number">Pelanggaran</TH><TH align="number">Σ Lebih</TH>
      </>}>
        {data.byCode.map((c) => (
          <tr key={c.code} className="hover:bg-slate-50">
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{c.code}</TD>
            <TD className="font-bold text-slate-800">{c.name}</TD>
            <TD align="number">{f.num(c.violations)}</TD>
            <TD align="number" className="font-black">{rp(c.excess)}</TD>
          </tr>
        ))}
        {data.byCode.length === 0 && (
          <tr><TD colSpan={4} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(violationsByCode), rp(data.sum.excess)]} spanLabel={2} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Audit kepatuhan plafon per jenis biaya (TravelExpenseType.limitAmount) — nilai lebih & persentase dihitung per baris biaya. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Ceiling compliance audit per expense type (TravelExpenseType.limitAmount) — excess values & percentages are computed per expense line. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR3.2 Lost Savings Opportunity Sheet =================
export function TR32View({ data, meta }: { data: TR32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr32");
  const CAT_TONE: Record<string, "sky" | "violet" | "amber"> = {
    hotel: "sky", "per-diem": "violet", "last-minute": "amber",
  };
  return (
    <ReportSheet docId="tr32" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R3.2"} title={def?.titleEn ?? "Lost Savings Opportunity Sheet"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr32", meta)} />

      <DocSection no="A" title={t("Ringkasan Pemborosan", "Waste Summary")} note={t("Acuan tarif = plafon hotel / uang harian kota (SBI, PMK 32/2025); last-minute = tiket dibeli ≤ 1 hari sebelum keberangkatan / sesudah.", "Reference rate = city hotel ceiling / per-diem (SBI, PMK 32/2025); last-minute = tickets bought ≤ 1 day before departure / after.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahun Buku", "Fiscal Year"), value: f.num(data.year) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Baris", "Total Lines"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Last-Minute", "Last-Minute"), value: f.num(data.lastMinuteCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Potensi Hemat", "Σ Lost Savings"), value: rp(data.sum.lost), accent: true }]} />
      </div>
      <p className="mt-2 text-[9.5px] italic text-slate-400">
        {t("Terpetakan SBI", "SBI-matched")}: {f.num(data.matchedCount)} / {f.num(data.total)} {t("baris", "lines")} · {data.methodology}
      </p>

      <DocSection no="B" title={t("Analisis Tarif Riil vs Acuan SBI", "Actual vs SBI Reference Analysis")} note={t("Selisih/malam = tarif riil − acuan SBI; potensi hemat = max(0, selisih × qty); kota tak terpetakan → tanpa perbandingan (—).", "Diff/night = actual rate − SBI reference; lost savings = max(0, diff × qty); unmatched city → no comparison (—).")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH>Karyawan</TH><TH>Kota</TH><TH>Komponen</TH>
              <TH align="number">Qty</TH><TH align="number">Tarif Riil</TH><TH align="number">Acuan SBI</TH>
              <TH align="number">Selisih/Malam</TH><TH align="number">Potensi Hemat</TH><TH align="center">Last-Minute</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => {
              const diff = i.actualPerUnit != null ? i.actualPerUnit - i.refRate : null;
              return (
                <tr key={`${i.claimDocNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.lastMinute && "bg-amber-50/40")}>
                  <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.claimDocNo}</TD>
                  <TD>
                    <p className="font-semibold text-slate-800">{i.name}</p>
                    <p className="text-[9px] text-slate-500">{i.employeeNo}</p>
                  </TD>
                  <TD>
                    <span className="font-bold text-slate-800">{i.city}</span>
                    {!i.cityMatched && <span className="ml-1 rounded bg-slate-100 px-1 py-px text-[8px] font-bold text-slate-500">{t("Tidak terpetakan", "Unmapped")}</span>}
                  </TD>
                  <TD>
                    <p className="text-[9.5px] font-bold text-slate-700">{i.typeName}</p>
                    <p className="font-mono text-[8.5px] text-slate-400">{i.code}</p>
                  </TD>
                  <TD align="number" className="font-bold">{f.num(i.qty)} <span className="text-[8.5px] font-normal text-slate-400">{i.qtyLabel}</span></TD>
                  <TD align="number">{rp(i.actualPerUnit)}</TD>
                  <TD align="number">
                    {rp(i.refRate)}
                    <span className="block text-[8px] text-slate-400">{i.refLabel}</span>
                  </TD>
                  <TD align="number" className={cn("font-bold", (diff ?? 0) > 0 && "text-red-600")}>{rp(diff)}</TD>
                  <TD align="number" className="font-black">{i.lost == null && !i.cityMatched ? <Dash /> : rp(i.lost)}</TD>
                  <TD align="center">
                    {i.lastMinute ? (
                      <DocBadge tone="amber">
                        {i.daysToDeparture == null
                          ? t("Last-Minute", "Last-Minute")
                          : i.daysToDeparture < 0
                            ? t("Last-Minute (saat trip)", "Last-Minute (during trip)")
                            : `Last-Minute (H-${i.daysToDeparture})`}
                      </DocBadge>
                    ) : <span className="text-slate-300">—</span>}
                  </TD>
                </tr>
              );
            })}
            {data.items.length === 0 && (
              <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada baris biaya yang dapat dianalisis tahun ini.", "No analyzable expense lines this year.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("baris", "lines")}`} cells={[rp(data.sum.lost), ""]} spanLabel={8} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Rekap per Kategori", "Recap per Category")} />
      <DocTable head={<>
        <TH>Kategori</TH><TH align="number">Baris</TH><TH align="number">Potensi Hemat</TH>
      </>}>
        {data.byCategory.map((c) => (
          <tr key={c.category} className="hover:bg-slate-50">
            <TD><DocBadge tone={CAT_TONE[c.category] ?? "slate"}>{c.categoryLabel}</DocBadge></TD>
            <TD align="number">{f.num(c.lines)}</TD>
            <TD align="number" className="font-black">{rp(c.lost)}</TD>
          </tr>
        ))}
        {data.byCategory.length === 0 && (
          <tr><TD colSpan={3} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.total), rp(data.sum.lost)]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Analisis potensi penghematan: tarif riil hotel/uang saku vs acuan SBI kota (PMK 32/2025) + pemesanan tiket mendadak. Kota tak terpetakan tidak dibandingkan (—). Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Lost-savings analysis: actual hotel/per-diem rates vs SBI city reference (PMK 32/2025) + last-minute ticket bookings. Unmapped cities are not compared (—). Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR3.3 Travel ROI / Cost-to-Business Impact Analysis =================
export function TR33View({ data, meta }: { data: TR33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr33");
  const utilTone = (pct: number): "red" | "amber" | "green" => (pct > 100 ? "red" : pct >= 80 ? "amber" : "green");
  const utilBar = (pct: number): string => (pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500");
  const sumEmp = data.rows.reduce((s, r) => s + r.employees, 0);
  const avgAll = data.total.settlement != null && data.total.trips > 0
    ? Math.round(data.total.settlement / data.total.trips)
    : null;
  return (
    <ReportSheet docId="tr33" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R3.3"} title={def?.titleEn ?? "Travel ROI / Cost-to-Business Impact Analysis"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr33", meta)} />

      <DocSection no="A" title={t("Ringkasan Dampak Biaya", "Cost Impact Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Cost Center", "Cost Centers"), value: f.num(data.rows.length), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Trips", "Total Trips"), value: f.num(data.total.trips) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Klaim", "Total Claims"), value: f.num(data.total.claims) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Settlement", "Σ Settlement"), value: rp(data.total.settlement) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Utilisasi Keseluruhan", "Overall Utilization"), value: f.pct(data.overallUtilization), accent: true }]} />
      </div>
      {data.unmatchedNote && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[9.5px] font-bold text-amber-700">{data.unmatchedNote}</p>
      )}
      <p className="mt-2 text-[9.5px] italic text-slate-400">{data.methodology}</p>

      <DocSection no="B" title={t("Biaya vs Anggaran per Cost Center", "Cost vs Budget per Cost Center")} note={t("Utilisasi = settlement ÷ anggaran × 100 (settlement = klaim selesai Approved/Transferred/Paid); progress bar dibatasi 100%.", "Utilization = settlement ÷ budget × 100 (settlement = settled claims Approved/Transferred/Paid); progress bar capped at 100%.")} />
      <DocTable head={<>
        <TH>Cost Center</TH><TH align="number">Trips</TH><TH align="number">Karyawan</TH><TH align="number">Klaim</TH>
        <TH align="number">Uang Muka</TH><TH align="number">Settlement</TH><TH align="number">Budget</TH>
        <TH align="center">Utilisasi %</TH><TH align="number">Rata-rata/Trip</TH><TH>Tujuan Utama</TH>
      </>}>
        {data.rows.map((r, idx) => (
          <tr key={r.costCenter} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD>
              <p className="font-mono text-[9.5px] font-bold text-slate-700">{r.costCenter}</p>
              <p className="text-[8.5px] text-slate-400">{r.costCenterLabel}</p>
            </TD>
            <TD align="number" className="font-bold">{f.num(r.trips)}</TD>
            <TD align="number">{f.num(r.employees)}</TD>
            <TD align="number">{f.num(r.claims)}</TD>
            <TD align="number">{rp(r.advance)}</TD>
            <TD align="number">{rp(r.settlement)}</TD>
            <TD align="number">{rp(r.budget)}</TD>
            <TD align="center">
              {r.utilizationPct != null ? (
                <div className="inline-block min-w-[92px]">
                  <DocBadge tone={utilTone(r.utilizationPct)}>{f.pct(r.utilizationPct)}</DocBadge>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={cn("h-full rounded-full", utilBar(r.utilizationPct))} style={{ width: `${Math.max(4, Math.min(100, r.utilizationPct))}%` }} />
                  </div>
                </div>
              ) : <Dash />}
            </TD>
            <TD align="number">{rpNa(r.avgPerTrip, r.trips === 0)}</TD>
            <TD className="max-w-40 text-[9.5px] text-slate-600">{r.topPurpose ?? <Dash />}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada cost center dengan aktivitas perjalanan tahun ini.", "No cost centers with travel activity this year.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL PERUSAHAAN", "COMPANY TOTAL")} cells={[
          f.num(data.total.trips), f.num(sumEmp), f.num(data.total.claims),
          rp(data.total.advance), rp(data.total.settlement), rp(data.total.budget),
          f.pct(data.overallUtilization), rpNa(avgAll, data.total.trips === 0), "",
        ]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Analisis dampak biaya perjalanan dinas terhadap anggaran cost center (TravelBudgetItem tahun berjalan) — utilisasi, rata-rata per trip, dan tujuan bisnis utama sebagai dasar justifikasi perjalanan. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Travel cost impact analysis against cost center budgets (TravelBudgetItem for the year) — utilization, average per trip, and top business purposes as trip justification basis. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR4.1 Corporate Travel Agent (CTA) Reconciliation Sheet =================
export function TR41View({ data, meta }: { data: TR41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr41");
  return (
    <ReportSheet docId="tr41" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R4.1"} title={def?.titleEn ?? "Corporate Travel Agent (CTA) Reconciliation Sheet"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr41", meta)} />

      <DocSection no="A" title={t("Ringkasan Rekonsiliasi", "Reconciliation Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Klaim", "Total Claims"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Belum Selesai", "Open"), value: f.num(data.openCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Selesai", "Settled"), value: f.num(data.settledCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Ditagih Korporat (a)", "Σ Corporate Billed (a)"), value: rp(data.sum.corporateBilled), accent: true }]} />
      </div>
      <p className="mt-2 text-[9.5px] italic text-slate-400">{data.manifestNote}</p>

      <DocSection no="B" title={t("Register Rekonsiliasi (urut tanggal klaim)", "Reconciliation Register (by claim date)")} note={t("(a) = biaya dibayar pihak lain / akun korporat; umur dihitung sejak tanggal klaim — badge merah bila > 30 hari.", "(a) = expenses paid by the other party / corporate account; aging is computed from the claim date — red badge when > 30 days.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH align="center">Tanggal</TH><TH>Karyawan</TH><TH align="center">No. SPPD</TH>
              <TH>Tujuan</TH><TH align="number">Ditagih Akun Korporat (a)</TH><TH align="number">Dibayar Karyawan (b)</TH>
              <TH align="number">Dikembalikan (c)</TH><TH align="number">Total Settlement</TH><TH>Jurnal</TH>
              <TH align="center">Status</TH><TH align="center">Umur</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.claimDocNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.ageDays > 30 && "bg-red-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.claimDocNo}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}</p>
                </TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.requestDocNo ?? <Dash />}</TD>
                <TD className="max-w-36 text-[9.5px] text-slate-600">
                  {i.destinations}
                  <span className="block text-[8.5px] text-slate-400">{i.purpose ?? i.templateName}</span>
                </TD>
                <TD align="number" className="font-black">{rp(i.corporateBilled)}</TD>
                <TD align="number">{rp(i.payableEmployee)}</TD>
                <TD align="number">{rp(i.payableCompany)}</TD>
                <TD align="number">{rp(i.totalSettlement)}</TD>
                <TD className="font-mono text-[9px] font-bold text-slate-700">{i.journalNo ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={CLAIM_TONE[i.status] ?? "slate"}>{t(...(CLAIM_LABEL[i.status] ?? [i.statusLabel, i.statusLabel]))}</DocBadge></TD>
                <TD align="center"><DocBadge tone={i.ageDays > 30 ? "red" : "slate"}>{f.num(i.ageDays)} {t("hari", "days")}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada tagihan akun korporat (a) pada tahun ini.", "No corporate-account billing (a) this year.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("klaim", "claims")}`} cells={[
              rp(data.sum.corporateBilled), rp(data.sum.payableEmployee), rp(data.sum.payableCompany),
              rp(data.sum.totalSettlement), "", "", "",
            ]} spanLabel={5} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Tren Bulanan", "Monthly Trend")} />
      <DocTable head={<>
        <TH>Bulan</TH><TH align="number">Klaim</TH><TH align="number">Ditagih Korporat</TH>
      </>}>
        {data.monthly.map((m, idx) => (
          <tr key={m.month} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{m.month}</TD>
            <TD align="number">{f.num(m.claims)}</TD>
            <TD align="number" className="font-bold">{rp(m.corporateBilled)}</TD>
          </tr>
        ))}
        {data.monthly.length === 0 && (
          <tr><TD colSpan={3} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada data bulanan.", "No monthly data yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL 12 BULAN", "12-MONTH TOTAL")} cells={[
          f.num(data.monthly.reduce((s, m) => s + m.claims, 0)),
          rp(sumMoney(data.monthly, (m) => m.corporateBilled)),
        ]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Pencocokan tagihan pihak ketiga / akun korporat (CTA) terhadap manifes keberangkatan & klaim karyawan di HRIS — mencegah double payment. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Third-party/corporate account (CTA) billing reconciliation against HRIS departure manifests & employee claims — preventing double payment. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR4.2 Hotel Vendor Volume Summary =================
export function TR42View({ data, meta }: { data: TR42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr42");
  const sumEmp = data.byCity.reduce((s, c) => s + c.employees, 0);
  const sumClaims = data.byCity.reduce((s, c) => s + c.claims, 0);
  const avgAll = data.sum.amount != null && data.sum.roomNights > 0
    ? Math.round(data.sum.amount / data.sum.roomNights)
    : null;
  const overCount = data.detail.filter((d) => d.overLimit).length;
  const overseasCities = data.byCity.filter((c) => c.overseas).length;
  return (
    <ReportSheet docId="tr42">
      <DocHeader meta={meta} reportNo={def?.no ?? "R4.2"} title={def?.titleEn ?? "Hotel Vendor Volume Summary"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr42", meta)} />

      <DocSection no="A" title={t("Ringkasan Volume Hotel", "Hotel Volume Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kota", "Cities"), value: f.num(data.cities), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Room Nights", "Room Nights"), value: f.num(data.sum.roomNights) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kota Luar Negeri", "Overseas Cities"), value: f.num(overseasCities) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Nominal", "Σ Amount"), value: rp(data.sum.amount), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Volume per Kota", "Volume per City")} note={t("Tarif rata-rata/malam = Σ nominal ÷ room nights; porsi % terhadap total hotel tahun berjalan.", "Average nightly rate = Σ amount ÷ room nights; share % of this year's total hotel spend.")} />
      <DocTable head={<>
        <TH>Kota</TH><TH align="number">Room Nights</TH><TH align="number">Total</TH><TH align="number">Tarif Rata-rata/Malam</TH>
        <TH align="number">Karyawan</TH><TH align="number">Klaim</TH><TH align="number">Porsi %</TH>
      </>}>
        {data.byCity.map((c, idx) => (
          <tr key={c.city} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD>
              <p className="font-bold text-slate-800">{c.city}</p>
              <p className="text-[8.5px] text-slate-400">{c.country}</p>
              {c.overseas && <span className="mt-0.5 inline-block rounded bg-violet-100 px-1 py-px text-[8px] font-bold text-violet-700">{t("Luar Negeri", "Overseas")}</span>}
            </TD>
            <TD align="number" className="font-bold">{f.num(c.roomNights)}</TD>
            <TD align="number" className="font-black">{rp(c.amount)}</TD>
            <TD align="number">{rpNa(c.avgRate, c.roomNights === 0)}</TD>
            <TD align="number">{f.num(c.employees)}</TD>
            <TD align="number">{f.num(c.claims)}</TD>
            <TD align="number">{f.pct(c.sharePct)}</TD>
          </tr>
        ))}
        {data.byCity.length === 0 && (
          <tr><TD colSpan={7} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada biaya hotel tahun ini.", "No hotel expenses this year yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(data.sum.roomNights), rp(data.sum.amount), rpNa(avgAll, data.sum.roomNights === 0),
          f.num(sumEmp), f.num(sumClaims), data.sum.amount != null ? "100%" : "—",
        ]} spanLabel={1} />
      </DocTable>

      <DocSection no="C" title={t("Rincian Biaya Hotel per Klaim", "Hotel Expense Detail per Claim")} note={t("Over-Limit = tarif malam melebihi plafon hotel kota (SBI).", "Over-Limit = nightly rate above the city hotel ceiling (SBI).")} />
      <div className="doc-scroll max-h-[420px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH>Karyawan</TH><TH>Kota</TH><TH align="center">Tanggal</TH>
              <TH align="number">Malam</TH><TH align="number">Tarif</TH><TH align="number">Nominal</TH><TH align="center">Over-Limit</TH>
            </tr>
          </thead>
          <tbody>
            {data.detail.map((d, idx) => (
              <tr key={`${d.claimDocNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", d.overLimit && "bg-red-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{d.claimDocNo}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{d.name}</p>
                  <p className="text-[9px] text-slate-500">{d.employeeNo}</p>
                </TD>
                <TD>
                  <span className="font-bold text-slate-800">{d.city}</span>
                  {!d.cityMatched && <span className="ml-1 rounded bg-slate-100 px-1 py-px text-[8px] font-bold text-slate-500">{t("Tidak terpetakan", "Unmapped")}</span>}
                </TD>
                <TD align="center">{f.dt(d.date)}</TD>
                <TD align="number" className="font-bold">{f.num(d.nights)}</TD>
                <TD align="number">{rpNa(d.rate, d.nights === 0)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(d.amount)}</TD>
                <TD align="center">
                  {d.overLimit
                    ? <DocBadge tone="red">{t("Melebihi Batas", "Over Limit")}</DocBadge>
                    : <span className="text-slate-300">—</span>}
                </TD>
              </tr>
            ))}
            {data.detail.length === 0 && (
              <tr><TD colSpan={8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada rincian biaya hotel pada tahun ini.", "No hotel expense details this year.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("baris", "lines")}`} cells={[
              f.num(data.sum.roomNights), rpNa(avgAll, data.sum.roomNights === 0), rp(data.sum.amount),
              overCount > 0 ? `${f.num(overCount)}×` : "",
            ]} spanLabel={4} />
          </tbody>
        </table>
      </div>

      <TravelDocFooter meta={meta} signNote={t("Rekap volume malam menginap (room nights) per kota pada jaringan hotel mitra — dasar negosiasi diskon/kontrak tahunan. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Room-night recap per city across partner hotel networks — basis for discount/annual contract renegotiation. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR4.3 Air Carrier Utilization Report =================
export function TR43View({ data, meta }: { data: TR43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr43");
  const MODE_TONE: Record<string, "sky" | "amber" | "slate"> = { air: "sky", rail: "amber", other: "slate" };
  const sumTickets = data.rows.reduce((s, r) => s + r.tickets, 0);
  const sumEmployees = data.rows.reduce((s, r) => s + r.employees, 0);
  const avgAll = data.sum.amount != null && sumTickets > 0
    ? Math.round(data.sum.amount / sumTickets)
    : null;
  return (
    <ReportSheet docId="tr43" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R4.3"} title={def?.titleEn ?? "Air Carrier Utilization Report"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr43", meta)} />

      <DocSection no="A" title={t("Ringkasan Utilisasi", "Utilization Summary")} note={t("Maskapai/operator di-parse best-effort dari deskripsi biaya; tiket tak teridentifikasi digabung per moda.", "Carriers are best-effort parsed from expense descriptions; unidentified tickets are grouped per mode.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tiket", "Total Tickets"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tiket Udara", "Air Tickets"), value: f.num(data.airTickets) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tiket Kereta", "Rail Tickets"), value: f.num(data.railTickets) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tak Teridentifikasi", "Unidentified"), value: f.num(data.unidentified) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Nominal", "Σ Amount"), value: rp(data.sum.amount), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Utilisasi per Maskapai / Operator", "Utilization per Carrier")} note={t("Tarif rata-rata = Σ nominal ÷ tiket; porsi % terhadap total tiket berbayar tahun berjalan.", "Average fare = Σ amount ÷ tickets; share % of this year's total paid tickets.")} />
      <DocTable head={<>
        <TH>Maskapai / Operator</TH><TH align="center">Mode</TH><TH align="number">Tiket</TH><TH align="number">Rute</TH>
        <TH align="number">Karyawan</TH><TH align="number">Total</TH><TH align="number">Porsi %</TH><TH align="number">Tarif Rata-rata</TH>
      </>}>
        {data.rows.map((r, idx) => (
          <tr key={`${r.carrier}-${r.mode}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{r.carrier}</TD>
            <TD align="center"><DocBadge tone={MODE_TONE[r.mode] ?? "slate"}>{r.modeLabel}</DocBadge></TD>
            <TD align="number" className="font-bold">{f.num(r.tickets)}</TD>
            <TD align="number">{f.num(r.routes)}</TD>
            <TD align="number">{f.num(r.employees)}</TD>
            <TD align="number" className="font-black">{rp(r.amount)}</TD>
            <TD align="number">{f.pct(r.sharePct)}</TD>
            <TD align="number">{rpNa(r.avgFare, r.tickets === 0)}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada tiket pesawat/kereta tahun ini.", "No air/rail tickets this year yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(sumTickets), "", f.num(sumEmployees), rp(data.sum.amount),
          data.sum.amount != null ? "100%" : "—", rpNa(avgAll, sumTickets === 0),
        ]} spanLabel={2} />
      </DocTable>

      <DocSection no="C" title={t("Rincian Tiket per Klaim", "Ticket Detail per Claim")} />
      <div className="doc-scroll max-h-[420px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH>Karyawan</TH><TH>Carrier</TH><TH>Rute</TH>
              <TH align="center">Tanggal</TH><TH align="number">Nominal</TH><TH align="center">Last-Minute</TH>
            </tr>
          </thead>
          <tbody>
            {data.detail.map((d, idx) => (
              <tr key={`${d.claimDocNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", d.lastMinute && "bg-amber-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{d.claimDocNo}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{d.name}</p>
                  <p className="text-[9px] text-slate-500">{d.employeeNo}</p>
                </TD>
                <TD className="font-bold text-slate-800">{d.carrier}</TD>
                <TD className="font-mono text-[9.5px]">{d.route ?? <Dash />}</TD>
                <TD align="center">{f.dt(d.expenseDate)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(d.amount)}</TD>
                <TD align="center">
                  {d.lastMinute
                    ? <DocBadge tone="amber">{t("Last-Minute", "Last-Minute")}</DocBadge>
                    : <span className="text-slate-300">—</span>}
                </TD>
              </tr>
            ))}
            {data.detail.length === 0 && (
              <tr><TD colSpan={7} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada rincian tiket pada tahun ini.", "No ticket details this year.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("tiket", "tickets")}`} cells={[rp(data.sum.amount)]} spanLabel={6} />
          </tbody>
        </table>
      </div>

      <TravelDocFooter meta={meta} signNote={t("Statistik utilisasi maskapai & kereta (best-effort parse dari deskripsi biaya) — dasar program corporate loyalty points & kontrak korporat. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Air & rail carrier utilization statistics (best-effort parsed from expense descriptions) — basis for corporate loyalty programs & contracts. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}
