"use client";
// TRAV-1-b — views dokumen Travel Grup 1 (Pengajuan & Validasi SPPD) + Grup 2 ===
// (Realisasi & Rekonsiliasi Biaya). Mirror pola medical/report-documents/
// report-views-g12.tsx (MED-1-b) — komponen dasar (ReportSheet/DocHeader/…)
// dipakai bersama dari doc-kit modul HR.
//
// AUDIT KOLOM (insiden R1.2 payroll & LR3.1): jumlah kolom thead = jumlah sel
// efektif tiap baris tbody; TotalRow spanLabel + cells.length = jumlah kolom.
//   TR11 B 9 kolom (span 7 + 2) · TR11 C 2 (1 + 1)
//   TR12 B 11 (7 + 4) · TR12 C 2 (1 + 1) · TR13 B 10 (9 + 1)
//   TR21 B 14 (6 + 8) · TR21 C 2 (1 + 1)
//   TR22 B 10 (5 + 5) · TR22 C 3 (1 + 2) · TR22 D 3 (1 + 2)
//   TR23 B 11 (9 + 2) · TR23 C 4 (1 + 3) · TR23 D 6 (2 + 4).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import { reportById } from "./catalog";
import type { DocMeta, TR11Data, TR12Data, TR13Data, TR21Data, TR22Data, TR23Data } from "./types";

/** No. dokumen deterministik: TR/TR11/2026/10 (mirror mkDocNo medical MC→TR). */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `TR/${id.slice(1).toUpperCase()}/${meta.year}/${mm}`;
}

/** Rupiah masked — null saat Brankas Uang terkunci (mirror LR1.3 leave). */
export const rp = (n: number | null) => (n == null ? <span className="text-slate-300">•••</span> : `Rp ${n.toLocaleString("id-ID")}`);

/** Uang null BUKAN karena brankas terkunci (mis. kota tak terpetakan → lost
 *  null; qty/tickets 0 → rata-rata null) → "—" alih-alih "•••" (audit MED-3
 *  bug 2: null && !masked harusnya Dash). */
export const rpNa = (n: number | null, na: boolean) => (na && n == null ? <Dash /> : rp(n));

/** Penjumlahan kolom uang dgn propagasi null (satu null → total null/•••). */
export function sumMoney<T>(arr: T[], pick: (x: T) => number | null): number | null {
  let out: number | null = 0;
  for (const x of arr) {
    const v = pick(x);
    if (v == null || out == null) out = null;
    else out += v;
  }
  return out;
}

// ===================== badge tone & label =====================

/** Status pengajuan perjalanan (R1.x). */
const REQ_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  Submitted: "amber", Approved: "green", Rejected: "red", Cancelled: "slate",
};
const REQ_LABEL: Record<string, [string, string]> = {
  Submitted: ["Menunggu Persetujuan", "Pending Approval"], Approved: ["Disetujui", "Approved"],
  Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
};
/** Status pencairan uang muka (R1.2). */
const ADVANCE_TONE: Record<string, "green" | "amber" | "slate"> = {
  Given: "green", Requested: "amber", Void: "slate",
};
const ADVANCE_LABEL: Record<string, [string, string]> = {
  Given: ["Dicairkan", "Disbursed"], Requested: ["Menunggu Pencairan", "Pending Disbursement"], Void: ["Dibatalkan", "Voided"],
};
/** Status settlement klaim (R1.2). */
const SETTLE_TONE: Record<string, "red" | "amber" | "green"> = {
  unsettled: "red", processing: "amber", settled: "green",
};
const SETTLE_LABEL: Record<string, [string, string]> = {
  unsettled: ["Belum Diajukan", "Not Submitted"], processing: ["Dalam Proses", "Processing"], settled: ["Selesai", "Settled"],
};
/** Fase perjalanan aktif (R1.3). */
const PHASE_TONE: Record<string, "red" | "amber" | "green"> = {
  "final-day": "red", "returning-soon": "amber", "mid-trip": "green",
};
const PHASE_LABEL: Record<string, [string, string]> = {
  "final-day": ["Hari Terakhir", "Final Day"], "returning-soon": ["Segera Pulang", "Returning Soon"], "mid-trip": ["Di Perjalanan", "On Assignment"],
};
/** Status klaim settlement (R2.x). */
const CLAIM_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Draft: "slate", Submitted: "amber", Approved: "sky", Rejected: "red", Cancelled: "slate",
  Transferred: "violet", Paid: "green", Settled: "green",
};
const CLAIM_LABEL: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"], Submitted: ["Menunggu Verifikasi", "Pending Verification"],
  Approved: ["Disetujui", "Approved"], Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
  Transferred: ["Ditransfer", "Transferred"], Paid: ["Dibayar", "Paid"], Settled: ["Selesai", "Settled"],
};
/** Kelompok jenis biaya (R2.2). */
const KIND_TONE: Record<string, "slate" | "sky" | "violet" | "amber"> = {
  GENERAL: "slate", ALLOWANCE: "sky", MILEAGE: "violet", ENTERTAINMENT: "amber",
};

// ===================== footer khusus Travel =====================
// Mirror struktur DocFooter/SignOffGrid doc-kit (HR) — disalin ke modul Travel
// karena peran persetujuan & baris kerahasiaan spesifik travel (brief TRAV-1-b):
// Karyawan/Travel Admin → Finance/Auditor → Kepala Departemen + baris
// tempat/tanggal + "DOKUMEN INTERNAL PERUSAHAAN (CONFIDENTIAL CORPORATE
// TRAVEL LOG)". doc-kit bersama TIDAK diubah (dipakai modul lain).

export function TravelSignOffGrid({ note }: { note?: string }) {
  const { t } = useI18n();
  const cols: { role: [string, string]; sub: [string, string] }[] = [
    { role: ["Disiapkan oleh,", "Prepared by,"], sub: ["Karyawan · Travel Admin", "Employee · Travel Admin"] },
    { role: ["Diperiksa oleh,", "Reviewed by,"], sub: ["Finance · Auditor Internal", "Finance · Internal Auditor"] },
    { role: ["Disetujui oleh,", "Approved by,"], sub: ["Kepala Departemen", "Department Head"] },
  ];
  return (
    <div className="mt-6">
      {note && <p className="mb-3 text-[9.5px] italic text-slate-500">{note}</p>}
      {/* baris tempat/tanggal */}
      <p className="mb-4 text-right text-[10px] font-bold text-slate-700">
        {t("Tempat / Tanggal", "Place / Date")}: ______________________________
      </p>
      <div className="grid grid-cols-3 gap-4 sm:gap-8">
        {cols.map((c) => (
          <div key={c.role[0]} className="text-center">
            <p className="text-[9.5px] font-bold text-slate-600">{t(...c.role)}</p>
            <p className="text-[8.5px] font-semibold uppercase tracking-wide text-slate-400">{t(...c.sub)}</p>
            <div className="mx-auto mt-8 mb-1 w-full border-b border-dashed border-slate-400" />
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-slate-400">
              {t("Nama & Tanda Tangan", "Name & Signature")}
            </p>
            <p className="text-[8.5px] text-slate-400">{t("Tanggal: ______________", "Date: ______________")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TravelDocFooter({ meta, signNote }: { meta: DocMeta; signNote?: string }) {
  const { t } = useI18n();
  return (
    <footer className="mt-8 border-t-2 border-slate-800 pt-3">
      <TravelSignOffGrid note={signNote} />
      <div className="mt-5 rounded-md bg-slate-900 px-4 py-2.5 text-center">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-200">
          {t("DOKUMEN INTERNAL PERUSAHAAN (CONFIDENTIAL CORPORATE TRAVEL LOG)", "INTERNAL COMPANY DOCUMENT (CONFIDENTIAL CORPORATE TRAVEL LOG)")}
        </p>
        <p className="mt-0.5 text-[8.5px] text-slate-400">
          {t(
            "Hanya untuk distribusi terbatas sesuai daftar penerima. Dilarang menggandakan/menyebarkan tanpa izin tertulis.",
            "Restricted distribution to listed recipients only. Do not copy or disseminate without written approval.",
          )}
          {" · "}
          {t("Dicetak dari RekanKerja HRIS oleh", "Printed from RekanKerja HRIS by")} {meta.printedBy}
        </p>
      </div>
    </footer>
  );
}

// ================= TR1.1 Master Travel Request & Log SPPD =================
export function TR11View({ data, meta }: { data: TR11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr11");
  return (
    <ReportSheet docId="tr11" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R1.1"} title={def?.titleEn ?? "Master Travel Request & SPPD Log"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr11", meta)} />

      <DocSection no="A" title={t("Ringkasan Pengajuan", "Request Summary")} note={t("Satu baris = satu Surat Perintah Perjalanan Dinas (SPPD); tujuan multi-kaki digabung (kaki 1 → kaki 2).", "One row = one travel order (SPPD); multi-leg destinations are joined (leg 1 → leg 2).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Pengajuan", "Total Requests"), value: f.num(data.total), accent: true }]} />
        {data.byStatus.map((s) => (
          <SummaryBox key={s.status} className="grid-cols-1" items={[{ label: s.label, value: f.num(s.count) }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Luar Negeri", "Overseas"), value: f.num(data.overseasCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Uang Muka", "Σ Cash Advance"), value: rp(data.sum.advance), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Daftar Pengajuan & Log SPPD", "Travel Request & SPPD Log")} note={t("Durasi dalam hari kalender (dateTo − dateFrom + 1); uang muka mengikuti status Brankas Uang (terkunci → •••).", "Duration in calendar days (dateTo − dateFrom + 1); cash advance follows the Money Vault status (locked → •••).")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. SPPD</TH><TH>Karyawan</TH><TH>Jenis</TH><TH>Tujuan</TH>
              <TH align="center">Perjalanan</TH><TH>Tujuan Bisnis</TH><TH align="center">CC</TH>
              <TH align="number">Uang Muka</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}{i.unit ? ` · ${i.unit}` : ""}</p>
                </TD>
                <TD>
                  <p className="text-[9.5px] font-bold text-slate-700">{i.templateName}</p>
                  <p className="font-mono text-[8.5px] text-slate-400">{i.templateCode}</p>
                </TD>
                <TD>
                  <span className="text-[9.5px] font-semibold text-slate-700">{i.destinations}</span>
                  {i.overseas && <span className="ml-1 rounded bg-violet-100 px-1 py-px text-[8px] font-bold text-violet-700">{t("Luar Negeri", "Overseas")}</span>}
                </TD>
                <TD align="center">
                  <p className="text-[9.5px] font-bold text-slate-700">{f.dt(i.dateFrom)} → {f.dt(i.dateTo)}</p>
                  <p className="text-[8.5px] text-slate-400">{f.num(i.durationDays)} {t("hari", "days")}</p>
                </TD>
                <TD className="max-w-44 text-[9.5px] text-slate-600">{i.purpose}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.costCenter ?? <Dash />}</TD>
                <TD align="number">{rp(i.advance)}</TD>
                <TD align="center"><DocBadge tone={REQ_TONE[i.status] ?? "slate"}>{t(...(REQ_LABEL[i.status] ?? [i.statusLabel, i.statusLabel]))}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada pengajuan perjalanan pada rentang / filter ini.", "No travel requests for this range / filter.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("pengajuan", "requests")} · ${data.claimRequestedCount} ${t("klaim diajukan", "claims filed")}`} cells={[
              rp(data.sum.advance), "",
            ]} spanLabel={7} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Sebaran Status Pengajuan", "Request Status Distribution")} />
      <DocTable head={<><TH>Status</TH><TH align="number">Jumlah</TH></>}>
        {data.byStatus.map((s) => (
          <tr key={s.status} className="hover:bg-slate-50">
            <TD><DocBadge tone={REQ_TONE[s.status] ?? "slate"}>{t(...(REQ_LABEL[s.status] ?? [s.label, s.label]))}</DocBadge></TD>
            <TD align="number">{f.num(s.count)}</TD>
          </tr>
        ))}
        {data.byStatus.length === 0 && (
          <tr><TD colSpan={2} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.total)]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Log master pengajuan perjalanan dinas & SPPD — nomor SPPD mengikuti penomoran dokumen TravelRequest. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Master travel request & SPPD log — SPPD numbers follow TravelRequest document numbering. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR1.2 Cash Advance Disbursed Sheet =================
export function TR12View({ data, meta }: { data: TR12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr12");
  return (
    <ReportSheet docId="tr12" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R1.2"} title={def?.titleEn ?? "Cash Advance Disbursed Sheet"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr12", meta)} />

      <DocSection no="A" title={t("Ringkasan Uang Muka", "Cash Advance Summary")} note={t("Outstanding = nominal uang muka − Σ settlement klaim selesai (Approved/Transferred/Paid).", "Outstanding = advance amount − Σ settled claims (Approved/Transferred/Paid).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Baris", "Total Rows"), value: f.num(data.items.length), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dicairkan", "Disbursed"), value: f.num(data.counts.given) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Pencairan", "Pending Disbursement"), value: f.num(data.counts.requested) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dibatalkan", "Voided"), value: f.num(data.counts.void) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Nominal", "Σ Amount"), value: rp(data.sum.amount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Outstanding", "Σ Outstanding"), value: rp(data.sum.outstanding), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Register Pencairan & Settlement (urut tanggal request)", "Disbursement & Settlement Register (by request date)")} note={t("Status settlement: Belum Diajukan = klaim belum dibuat · Dalam Proses = klaim menunggu/verifikasi · Selesai = klaim sudah dibayar/ditransfer.", "Settlement status: Not Submitted = no claim yet · Processing = pending/verification · Settled = paid/transferred.")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. SPPD</TH><TH>Karyawan</TH><TH>Tujuan</TH><TH align="center">Tgl Request</TH>
              <TH align="center">Periode Trip</TH><TH align="center">Status Uang Muka</TH><TH align="center">Tgl Cair</TH>
              <TH align="number">Nominal</TH><TH>Klaim</TH><TH align="center">Settlement</TH><TH align="number">Outstanding</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.docNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.settlement === "unsettled" && "bg-red-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}{i.unit ? ` · ${i.unit}` : ""}</p>
                </TD>
                <TD className="max-w-40 text-[9.5px] font-semibold text-slate-700">{i.destinations}</TD>
                <TD align="center">{f.dt(i.requestDate)}</TD>
                <TD align="center" className="text-[9.5px]">{f.dt(i.tripFrom)} → {f.dt(i.tripTo)}</TD>
                <TD align="center"><DocBadge tone={ADVANCE_TONE[i.advanceStatus] ?? "slate"}>{t(...(ADVANCE_LABEL[i.advanceStatus] ?? [i.advanceStatusLabel, i.advanceStatusLabel]))}</DocBadge></TD>
                <TD align="center">{f.dt(i.givenAt)}</TD>
                <TD align="number">{rp(i.amount)}</TD>
                <TD>
                  {i.claimDocNo ? (
                    <>
                      <p className="font-mono text-[9.5px] font-bold text-slate-700">{i.claimDocNo}</p>
                      {i.claimStatusLabel && <p className="text-[8.5px] text-slate-400">{i.claimStatusLabel}</p>}
                    </>
                  ) : <Dash />}
                </TD>
                <TD align="center"><DocBadge tone={SETTLE_TONE[i.settlement] ?? "slate"}>{t(...(SETTLE_LABEL[i.settlement] ?? [i.settlementLabel, i.settlementLabel]))}</DocBadge></TD>
                <TD align="number" className="font-black">{rp(i.outstanding)}</TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada uang muka perjalanan pada rentang / filter ini.", "No travel cash advances for this range / filter.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.items.length} ${t("baris uang muka", "advance rows")}`} cells={[
              rp(data.sum.amount), "", "", rp(data.sum.outstanding),
            ]} spanLabel={7} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Sebaran Status Pencairan", "Disbursement Status Distribution")} />
      <DocTable head={<><TH>Status</TH><TH align="number">Jumlah</TH></>}>
        {data.byStatus.map((s) => (
          <tr key={s.status} className="hover:bg-slate-50">
            <TD><DocBadge tone={ADVANCE_TONE[s.status] ?? "slate"}>{t(...(ADVANCE_LABEL[s.status] ?? [s.label, s.label]))}</DocBadge></TD>
            <TD align="number">{f.num(s.count)}</TD>
          </tr>
        ))}
        {data.byStatus.length === 0 && (
          <tr><TD colSpan={2} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.items.length)]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Register uang muka perjalanan dinas — outstanding dihitung per karyawan terhadap settlement klaim selesai. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Travel cash advance register — outstanding is computed per employee against settled claims. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR1.3 Active Business Travelers Tracking Sheet =================
export function TR13View({ data, meta }: { data: TR13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr13");
  return (
    <ReportSheet docId="tr13" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R1.3"} title={def?.titleEn ?? "Active Business Travelers Tracking Sheet"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr13", meta)} />

      {/* KOP KHUSUS — potret posisi tanggal laporan */}
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">
        {t(`POSISI PER ${f.dt(data.asOf)} — karyawan berstatus Approved dengan dateFrom ≤ tanggal laporan ≤ dateTo.`, `POSITION AS OF ${f.dt(data.asOf)} — employees with Approved status and dateFrom ≤ report date ≤ dateTo.`)}
      </p>

      <DocSection no="A" title={t("Ringkasan Posisi", "Position Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Aktif", "Total Active"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Luar Negeri", "Overseas"), value: f.num(data.overseasCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Domestik", "Domestic"), value: f.num(data.domesticCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Segera Pulang", "Returning Soon"), value: f.num(data.returningSoon) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Uang Muka", "Σ Cash Advance"), value: rp(data.sum.advance) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Karyawan Aktif Bertugas", "Active Traveler Register")} note={t("Kota saat ini = kaki destinasi berdasarkan tanggal laporan; hari ke = posisi hari dalam durasi trip; fase: Segera Pulang ≤ 2 hari lagi, Hari Terakhir = hari kepulangan.", "Current city = destination leg by report date; day-no = position within the trip; phase: Returning Soon ≤ 2 days left, Final Day = return day.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. SPPD</TH><TH>Karyawan</TH><TH>Tujuan</TH><TH>Kota Saat Ini</TH>
              <TH align="center">Hari ke</TH><TH align="center">Pulang</TH><TH align="center">CC</TH>
              <TH>Tujuan</TH><TH align="number">Uang Muka</TH><TH align="center">Fase</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.phase === "final-day" && "bg-red-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}{i.unit ? ` · ${i.unit}` : ""}</p>
                  {i.phone && <p className="text-[8.5px] text-slate-400">{t("Telp", "Phone")}: {i.phone}</p>}
                  {i.grade && <span className="mt-0.5 inline-block rounded bg-violet-100 px-1 py-px text-[8px] font-bold text-violet-700">{i.grade}</span>}
                </TD>
                <TD>
                  <span className="text-[9.5px] font-semibold text-slate-700">{i.destinations}</span>
                  {i.overseas && <span className="ml-1 rounded bg-violet-100 px-1 py-px text-[8px] font-bold text-violet-700">{t("Luar Negeri", "Overseas")}</span>}
                </TD>
                <TD className="font-bold text-slate-800">{i.currentCity}</TD>
                <TD align="center" className="font-black tabular-nums">{f.num(i.dayNo)}/{f.num(i.totalDays)}</TD>
                <TD align="center">
                  <p className="text-[9.5px] font-bold text-slate-700">{f.dt(i.tripTo)}</p>
                  <p className="text-[8.5px] text-slate-400">{f.num(i.daysToReturn)} {t("hari lagi", "days left")}</p>
                </TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.costCenter ?? <Dash />}</TD>
                <TD className="max-w-40 text-[9.5px] text-slate-600">{i.purpose}</TD>
                <TD align="number">{rp(i.advance)}</TD>
                <TD align="center"><DocBadge tone={PHASE_TONE[i.phase] ?? "slate"}>{t(...(PHASE_LABEL[i.phase] ?? [i.phaseLabel, i.phaseLabel]))}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada karyawan yang sedang bertugas di luar kota 🎉", "No employees currently on out-of-town assignment 🎉")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("karyawan aktif", "active travelers")}`} cells={[rp(data.sum.advance)]} spanLabel={9} />
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[9.5px] italic text-slate-500">
        {t("Mitigasi: hubungi karyawan via telepon tercantum untuk keadaan darurat; fase Segera Pulang / Hari Terakhir perlu dipantau untuk keberangkatan berikutnya (pengingat klaim settlement).", "Mitigation: contact employees via the listed phone in emergencies; Returning Soon / Final Day phases need monitoring for follow-on trips (settlement claim reminders).")}
      </p>

      <TravelDocFooter meta={meta} signNote={t("Potret posisi real-time per tanggal laporan — hanya request Approved dengan tanggal berjalan di antara dateFrom–dateTo. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Real-time position snapshot as of the report date — only Approved requests with the report date between dateFrom–dateTo. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR2.1 Travel Settlement & Expense Claim Register =================
export function TR21View({ data, meta }: { data: TR21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr21");
  return (
    <ReportSheet docId="tr21" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R2.1"} title={def?.titleEn ?? "Travel Settlement & Expense Claim Register"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr21", meta)} />

      <DocSection no="A" title={t("Ringkasan Settlement", "Settlement Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Klaim", "Total Claims"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Rincian Nota", "Σ Expense Lines"), value: rp(data.sum.expenseTotal) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ (a) Ditagih Korporat", "Σ (a) Corporate Billed"), value: rp(data.sum.otherCompanyExp) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Rugi Kurs", "Σ Exchange Loss"), value: rp(data.sum.exchangeLoss) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Total Settlement", "Σ Total Settlement"), value: rp(data.sum.totalSettlement) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Uang Muka", "Σ Cash Advance"), value: rp(data.sum.advance) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ (b) Dibayar Karyawan", "Σ (b) Paid to Employee"), value: rp(data.sum.payableEmployee) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ (c) Dikembalikan", "Σ (c) Returned"), value: rp(data.sum.payableCompany), accent: true }]} />
      </div>

      {/* strip formula a/b/c — mirror formula strip medical */}
      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] leading-relaxed text-amber-800">
        {t(
          "Total Settlement (bruto) = Σ rincian nota + rugi kurs − (a) ditagih korporat · (b) dibayar karyawan = settlement − uang muka (kekurangan dicairkan) · (c) dikembalikan perusahaan = uang muka − settlement (kelebihan).",
          "Total Settlement (gross) = Σ receipt lines + exchange loss − (a) corporate billed · (b) paid to employee = settlement − cash advance (shortfall disbursed) · (c) returned to company = cash advance − settlement (excess).",
        )}
      </p>

      <DocSection no="B" title={t("Register Settlement per Klaim (urut tanggal klaim)", "Settlement Register per Claim (by claim date)")} note={t("Setiap baris = satu dokumen klaim settlement; jurnal & periode terisi setelah klaim diposting ke buku besar.", "Each row = one settlement claim document; journal & period are filled after the claim is posted to the ledger.")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH align="center">Tanggal</TH><TH>Karyawan</TH><TH align="center">No. SPPD</TH>
              <TH>Tujuan / Purpose</TH><TH>Rincian</TH><TH align="number">(a) Ditagih Korporat</TH><TH align="number">Rugi Kurs</TH>
              <TH align="number">Total Settlement</TH><TH align="number">Uang Muka</TH><TH align="number">(b) Dibayar Karyawan</TH>
              <TH align="number">(c) Dikembalikan</TH><TH>Jurnal / Periode</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}{i.unit ? ` · ${i.unit}` : ""}</p>
                </TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.requestDocNo ?? <Dash />}</TD>
                <TD className="max-w-36 text-[9.5px] text-slate-600">
                  {i.purpose ?? <Dash />}
                  <span className="block text-[8.5px] text-slate-400">{i.templateName}</span>
                </TD>
                <TD>
                  <p className="text-[9.5px] font-bold text-slate-700">{f.num(i.expenseCount)} {t("baris", "lines")}</p>
                  <p className="text-[8.5px] text-slate-400">{rp(i.expenseTotal)}</p>
                </TD>
                <TD align="number">{rp(i.otherCompanyExp)}</TD>
                <TD align="number">{rp(i.exchangeLoss)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.totalSettlement)}</TD>
                <TD align="number">{rp(i.advance)}</TD>
                <TD align="number">{rp(i.payableEmployee)}</TD>
                <TD align="number">{rp(i.payableCompany)}</TD>
                <TD>
                  {i.journalNo ? (
                    <>
                      <p className="font-mono text-[9px] font-bold text-slate-700">{i.journalNo}</p>
                      {i.periodCode && <p className="text-[8.5px] text-slate-400">{i.periodCode}</p>}
                    </>
                  ) : <Dash />}
                </TD>
                <TD align="center"><DocBadge tone={CLAIM_TONE[i.status] ?? "slate"}>{t(...(CLAIM_LABEL[i.status] ?? [i.statusLabel, i.statusLabel]))}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={14} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada klaim settlement pada rentang / filter ini.", "No settlement claims for this range / filter.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("klaim", "claims")}`} cells={[
              rp(data.sum.otherCompanyExp), rp(data.sum.exchangeLoss), rp(data.sum.totalSettlement),
              rp(data.sum.advance), rp(data.sum.payableEmployee), rp(data.sum.payableCompany), "", "",
            ]} spanLabel={6} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Sebaran Status Klaim", "Claim Status Distribution")} />
      <DocTable head={<><TH>Status</TH><TH align="number">Jumlah</TH></>}>
        {data.byStatus.map((s) => (
          <tr key={s.status} className="hover:bg-slate-50">
            <TD><DocBadge tone={CLAIM_TONE[s.status] ?? "slate"}>{t(...(CLAIM_LABEL[s.status] ?? [s.label, s.label]))}</DocBadge></TD>
            <TD align="number">{f.num(s.count)}</TD>
          </tr>
        ))}
        {data.byStatus.length === 0 && (
          <tr><TD colSpan={2} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.total)]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Register pertanggungjawaban pasca-perjalanan — (a) biaya yang dibayar pihak lain/akun korporat, (b) kekurangan dicairkan ke karyawan, (c) kelebihan dikembalikan ke perusahaan. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Post-trip accountability register — (a) expenses borne by the other party/corporate account, (b) shortfall disbursed to the employee, (c) excess returned to the company. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR2.2 Itemized Expense Category Breakdown =================
export function TR22View({ data, meta }: { data: TR22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr22");
  const sumQty = data.rows.reduce((s, r) => s + r.qty, 0);
  const avgAll = data.total.amount != null && data.total.lines > 0
    ? Math.round(data.total.amount / data.total.lines)
    : null;
  const kindTotal = sumMoney(data.byKind, (k) => k.amount);
  return (
    <ReportSheet docId="tr22" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R2.2"} title={def?.titleEn ?? "Itemized Expense Category Breakdown"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr22", meta)} />

      <DocSection no="A" title={t("Ringkasan Komponen Biaya", "Expense Component Summary")} note={t("Qty = Σ unit (hari utk uang saku, km mileage, malam hotel); over-limit = baris di atas plafon jenis biaya.", "Qty = Σ units (days for per diem, km for mileage, nights for hotel); over-limit = lines above the expense-type ceiling.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahun Buku", "Fiscal Year"), value: f.num(data.year), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jenis Biaya", "Expense Types"), value: f.num(data.rows.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Baris", "Total Lines"), value: f.num(data.total.lines) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Nominal", "Σ Amount"), value: rp(data.total.amount), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Rincian per Komponen Biaya", "Breakdown per Expense Component")} />
      <DocTable head={<>
        <TH>Kode</TH><TH>Jenis Biaya</TH><TH align="center">Kelompok</TH><TH align="number">Klaim</TH>
        <TH align="number">Baris</TH><TH align="number">Qty</TH><TH align="number">Total</TH>
        <TH align="center">Over-Limit</TH><TH align="number">Porsi %</TH><TH align="number">Rata-rata/Baris</TH>
      </>}>
        {data.rows.map((r, idx) => (
          <tr key={r.code} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{r.code}</TD>
            <TD className="font-bold text-slate-800">{r.name}</TD>
            <TD align="center"><DocBadge tone={KIND_TONE[r.kind] ?? "slate"}>{r.kindLabel}</DocBadge></TD>
            <TD align="number">{f.num(r.claimCount)}</TD>
            <TD align="number">{f.num(r.expenseCount)}</TD>
            <TD align="number">{f.num(r.qty)}</TD>
            <TD align="number" className="font-black">{rp(r.amount)}</TD>
            <TD align="center">
              {r.overLimitCount > 0
                ? <DocBadge tone="red">{f.num(r.overLimitCount)}×</DocBadge>
                : <span className="text-slate-300">—</span>}
            </TD>
            <TD align="number">{f.pct(r.sharePct)}</TD>
            <TD align="number">{rpNa(r.avgPerLine, r.expenseCount === 0)}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada biaya perjalanan tahun ini.", "No travel expenses this year yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          "", f.num(sumQty), rp(data.total.amount), f.num(data.total.overLimitCount),
          data.total.amount != null ? "100%" : "—", rpNa(avgAll, data.total.lines === 0),
        ]} spanLabel={5} />
      </DocTable>

      <DocSection no="C" title={t("Rekap per Kelompok Biaya", "Recap per Expense Group")} />
      <DocTable head={<>
        <TH>Kelompok</TH><TH align="number">Total</TH><TH align="number">Porsi %</TH>
      </>}>
        {data.byKind.map((k) => (
          <tr key={k.kind} className="hover:bg-slate-50">
            <TD><DocBadge tone={KIND_TONE[k.kind] ?? "slate"}>{k.kindLabel}</DocBadge></TD>
            <TD align="number" className="font-black">{rp(k.amount)}</TD>
            <TD align="number">{f.pct(k.sharePct)}</TD>
          </tr>
        ))}
        {data.byKind.length === 0 && (
          <tr><TD colSpan={3} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[rp(kindTotal), kindTotal != null ? "100%" : "—"]} spanLabel={1} />
      </DocTable>

      <DocSection no="D" title={t("Tren Bulanan", "Monthly Trend")} />
      <DocTable head={<>
        <TH>Bulan</TH><TH align="number">Baris</TH><TH align="number">Nominal</TH>
      </>}>
        {data.monthly.map((m, idx) => (
          <tr key={m.month} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{m.month}</TD>
            <TD align="number">{f.num(m.lines)}</TD>
            <TD align="number" className="font-bold">{rp(m.amount)}</TD>
          </tr>
        ))}
        {data.monthly.length === 0 && (
          <tr><TD colSpan={3} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada biaya tahun ini.", "No expenses this year yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL 12 BULAN", "12-MONTH TOTAL")} cells={[
          f.num(data.monthly.reduce((s, m) => s + m.lines, 0)),
          rp(sumMoney(data.monthly, (m) => m.amount)),
        ]} spanLabel={1} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Rekap biaya perjalanan dinas per komponen pengeluaran (kode L-*/O-*/E-*) beserta tren 12 bulan — dasar penyusunan anggaran perjalanan & negosiasi plafon. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Travel expense recap per component (L-*/O-*/E-* codes) with a 12-month trend — basis for travel budgeting & ceiling negotiation. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= TR2.3 Mileage & Local Transport Reimbursement Log =================
export function TR23View({ data, meta }: { data: TR23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const def = reportById("tr23");
  const CAT_TONE: Record<string, "violet" | "amber" | "sky" | "green"> = {
    "mileage-km": "violet", fuel: "amber", "local-rent": "sky", "local-rail": "green",
  };
  return (
    <ReportSheet docId="tr23" landscape>
      <DocHeader meta={meta} reportNo={def?.no ?? "R2.3"} title={def?.titleEn ?? "Mileage & Local Transport Reimbursement Log"} subtitle={def ? t(def.descId, def.descEn) : undefined} audience={def?.audience} docNo={mkDocNo("tr23", meta)} />

      <DocSection no="A" title={t("Ringkasan Reimburse", "Reimbursement Summary")} note={t("Kendaraan pribadi dihitung per km (L-JARAK); BBM, sewa lokal, taksi & kereta lokal per baris biaya.", "Private vehicles are reimbursed per km (L-JARAK); fuel, local rental, taxi & local rail per expense line.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Baris", "Total Lines"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total KM Pribadi", "Private KM Total"), value: `${f.num(data.totalKm)} km` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jenis Biaya", "Expense Types"), value: f.num(data.byCode.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Σ Nominal", "Σ Amount"), value: rp(data.sum.amount), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Log Reimburse per Baris Biaya (urut tanggal klaim)", "Reimbursement Log per Expense Line (by claim date)")} note={t("Tarif satuan = nominal ÷ qty; flag Over-Limit ditandai bila nominal baris melebihi plafon jenis biaya.", "Unit rate = amount ÷ qty; the Over-Limit flag marks lines above the expense-type ceiling.")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">No. Klaim</TH><TH align="center">Tanggal</TH><TH>Karyawan</TH><TH align="center">Tgl Biaya</TH>
              <TH>Kode</TH><TH align="center">Kategori</TH><TH>Deskripsi</TH><TH align="number">Qty</TH>
              <TH align="number">Tarif Satuan</TH><TH align="number">Nominal</TH><TH align="center">Over-Limit</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.claimDocNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.overLimit && "bg-red-50/40")}>
                <TD align="center" className="font-mono text-[9.5px] font-bold text-slate-700">{i.claimDocNo}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD>
                  <p className="font-semibold text-slate-800">{i.name}</p>
                  <p className="text-[9px] text-slate-500">{i.employeeNo}{i.unit ? ` · ${i.unit}` : ""}</p>
                </TD>
                <TD align="center">{f.dt(i.expenseDate)}</TD>
                <TD>
                  <p className="font-mono text-[9.5px] font-bold text-slate-700">{i.code}</p>
                  <p className="text-[8.5px] text-slate-400">{i.typeName}</p>
                </TD>
                <TD align="center"><DocBadge tone={CAT_TONE[i.category] ?? "slate"}>{i.categoryLabel}</DocBadge></TD>
                <TD className="max-w-44 text-[9.5px] text-slate-600">{i.description ?? <Dash />}</TD>
                <TD align="number" className="font-bold">{f.num(i.qty)} <span className="text-[8.5px] font-normal text-slate-400">{i.qtyLabel}</span></TD>
                <TD align="number">{rpNa(i.rate, i.qty === 0)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.amount)}</TD>
                <TD align="center">
                  {i.overLimit
                    ? <DocBadge tone="red">{t("Melebihi Batas", "Over Limit")}</DocBadge>
                    : <span className="text-slate-300">—</span>}
                </TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada reimburse mileage/transport lokal pada rentang ini.", "No mileage/local-transport reimbursements in this range.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("baris", "lines")}`} cells={[rp(data.sum.amount), ""]} spanLabel={9} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Rekap per Kategori", "Recap per Category")} />
      <DocTable head={<>
        <TH>Kategori</TH><TH align="number">Baris</TH><TH align="number">Qty</TH><TH align="number">Nominal</TH>
      </>}>
        {data.byCategory.map((c) => (
          <tr key={c.category} className="hover:bg-slate-50">
            <TD><DocBadge tone={CAT_TONE[c.category] ?? "slate"}>{c.categoryLabel}</DocBadge></TD>
            <TD align="number">{f.num(c.lines)}</TD>
            <TD align="number">{f.num(c.qty)}</TD>
            <TD align="number" className="font-black">{rp(c.amount)}</TD>
          </tr>
        ))}
        {data.byCategory.length === 0 && (
          <tr><TD colSpan={4} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.total), "", rp(data.sum.amount)]} spanLabel={1} />
      </DocTable>

      <DocSection no="D" title={t("Rekap per Kode Biaya", "Recap per Expense Code")} />
      <DocTable head={<>
        <TH>Kode</TH><TH>Jenis Biaya</TH><TH align="number">Baris</TH><TH align="number">Qty</TH>
        <TH align="number">Nominal</TH><TH align="number">Tarif Rata-rata</TH>
      </>}>
        {data.byCode.map((c) => (
          <tr key={c.code} className="hover:bg-slate-50">
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{c.code}</TD>
            <TD className="font-bold text-slate-800">{c.name}</TD>
            <TD align="number">{f.num(c.lines)}</TD>
            <TD align="number">{f.num(c.qty)}</TD>
            <TD align="number" className="font-black">{rp(c.amount)}</TD>
            <TD align="number">{rpNa(c.avgRate, c.qty === 0)}</TD>
          </tr>
        ))}
        {data.byCode.length === 0 && (
          <tr><TD colSpan={6} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.total), "", rp(data.sum.amount), ""]} spanLabel={2} />
      </DocTable>

      <TravelDocFooter meta={meta} signNote={t("Log reimburse penggunaan kendaraan pribadi & transportasi lokal — tarif satuan dihitung dari nominal ÷ qty per baris. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Private-vehicle & local-transport reimbursement log — unit rates are computed as amount ÷ qty per line. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}
