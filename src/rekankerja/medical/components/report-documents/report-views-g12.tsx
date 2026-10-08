"use client";
// MED-1-b — views dokumen Medical Grup 1 (Saldo & Plafon) + Grup 2 (Klaim) ======
// Mirror pola leave/report-documents/report-views-g12.tsx (T112). Komponen dasar
// (ReportSheet/DocHeader/…) dipakai bersama dari doc-kit modul HR — murni
// presentasional, tipe DocMeta identik struktural.
//
// AUDIT KOLOM (insiden R1.2 payroll & LR3.1): jumlah kolom thead = jumlah sel
// efektif tiap baris tbody; TotalRow spanLabel + cells.length = jumlah kolom.
//   MR11 B 12 kolom (span 7 + 5) · MR11 C 5 (2 + 3) · MR12 B 11 (10 + 1)
//   MR13 B 7 (2 + 5) · MR13 C 4 (1 + 3) · MR21 B 14 (11 + 3) · MR21 C 2 (1 + 1)
//   MR22 B 13 (12 + 1) · MR23 B 12 (10 + 2) · MR23 C 6 (3 + 3).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type { DocMeta, MR11Data, MR12Data, MR13Data, MR21Data, MR22Data, MR23Data } from "./types";

/** No. dokumen deterministik: MC/MR11/2026/10. */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `MC/${id.slice(1).toUpperCase()}/${meta.year}/${mm}`;
}

/** Rupiah masked — null saat Brankas Uang terkunci (mirror LR1.3 leave). */
export const rp = (n: number | null) => (n == null ? <span className="text-slate-300">•••</span> : `Rp ${n.toLocaleString("id-ID")}`);

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

/** Tone badge status klaim medical. */
const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky"> = {
  Settled: "green", Approved: "sky", Submitted: "amber", Draft: "slate", Rejected: "red", Cancelled: "slate",
};
const STATUS_LABEL: Record<string, [string, string]> = {
  Settled: ["Settled (Dibayar)", "Settled (Paid)"], Approved: ["Disetujui", "Approved"],
  Submitted: ["Menunggu Verifikasi", "Pending Verification"], Draft: ["Draft", "Draft"],
  Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
};
/** Status urgensi saldo plafon (MR11) & alert utilizer (MR12). */
const BALANCE_TONE: Record<string, "red" | "amber" | "violet" | "green"> = {
  exhausted: "red", critical: "red", warning: "amber", caution: "violet", safe: "green",
};
const BALANCE_LABEL: Record<string, [string, string]> = {
  exhausted: ["Habis (0%)", "Exhausted (0%)"], critical: ["Kritis (<5%)", "Critical (<5%)"],
  warning: ["Waspada (5–10%)", "Warning (5–10%)"], caution: ["Perhatian (10–20%)", "Caution (10–20%)"],
  safe: ["Aman (≥20%)", "Safe (≥20%)"],
};

/** Banner brankas uang terkunci (mirror LR1.3 leave baris 178-181). */
function MaskedBanner() {
  const { t } = useI18n();
  return (
    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
      {t("⚠ Brankas uang terkunci — nilai rupiah disembunyikan (•••). Buka Brankas Uang untuk menampilkan nilai.", "⚠ Money vault locked — rupiah values hidden (•••). Open the Money Vault to reveal values.")}
    </p>
  );
}

// ================= MR1.1 Employee Medical Benefit Limit Balance =================
export function MR11View({ data, meta }: { data: MR11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr11" landscape>
      <DocHeader meta={meta} reportNo="R1.1" title="Employee Medical Benefit Limit Balance" subtitle={t("Saldo plafon medis per karyawan: pagu tahunan (benefit + penyesuaian + bawa), terpakai, sisa, dan status urgensi", "Employee medical limit balance: annual quota (benefit + adjustment + carry-over), used, remaining, and urgency status")} audience={t("HR C&B · Karyawan (ESS) · Finance", "HR C&B · Employees (ESS) · Finance")} docNo={mkDocNo("mr11", meta)} />

      <DocSection no="A" title={t("Ringkasan Saldo", "Balance Summary")} note={t("Plafon efektif = benefit kebijakan + penyesuaian + bawa periode lalu; sisa = plafon efektif − terpakai.", "Effective limit = policy benefit + adjustment + carry-over; remaining = effective limit − used.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan dgn Saldo", "Employees w/ Balance"), value: f.num(data.employees), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris Saldo", "Balance Rows"), value: f.num(data.total) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Plafon", "Total Limit"), value: rp(data.sum.plafon) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Terpakai", "Total Used"), value: rp(data.sum.used) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Sisa", "Total Remaining"), value: rp(data.sum.remaining), accent: true }]} />
      </div>
      {data.masked && <MaskedBanner />}

      <DocSection no="B" title={t("Daftar Saldo per Karyawan (urut Unit & No.)", "Balance Register (by Unit & No.)")} note={t("Penerima = karyawan atau tanggungan; status saldo: kritis < 5%, waspada < 10%, perhatian < 20% dari sisa plafon.", "Recipient = employee or dependent; balance status: critical < 5%, warning < 10%, caution < 20% of remaining limit.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit / Departemen</TH>
              <TH align="center">Status</TH><TH>Jenis Benefit</TH><TH align="center">Penerima</TH>
              <TH align="number">Plafon Efektif</TH><TH align="number">Terpakai</TH><TH align="number">Sisa Saldo</TH>
              <TH align="number">% Terpakai</TH><TH align="center">Status Saldo</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.employeeNo}-${r.typeCode}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="center">{r.employmentStatus}</TD>
                <TD className="text-[9.5px]">{r.typeName}</TD>
                <TD align="center">{r.dependent ? t("Tanggungan", "Dependent") : t("Karyawan", "Employee")}</TD>
                <TD align="number">{rp(r.plafon)}</TD>
                <TD align="number">{rp(r.used)}</TD>
                <TD align="number" className={cn("font-black", (r.remaining ?? 1) <= 0 && "text-red-600")}>{rp(r.remaining)}</TD>
                <TD align="number">{f.pct(r.usedPct)}</TD>
                <TD align="center"><DocBadge tone={BALANCE_TONE[r.status] ?? "slate"}>{t(...(BALANCE_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada saldo plafon pada tahun buku ini.", "No limit balances for this benefit year.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("baris", "rows")} · ${data.employees} ${t("karyawan", "employees")}`} cells={[
              rp(data.sum.plafon), rp(data.sum.used), rp(data.sum.remaining), "", "",
            ]} spanLabel={7} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Rekap per Jenis Benefit", "Recap per Benefit Type")} />
      <DocTable head={<>
        <TH>Jenis Benefit</TH><TH align="number">Baris</TH>
        <TH align="number">Plafon</TH><TH align="number">Terpakai</TH><TH align="number">Sisa</TH>
      </>}>
        {data.byType.map((ty) => (
          <tr key={ty.typeCode} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{ty.typeName}</TD>
            <TD align="number">{f.num(ty.count)}</TD>
            <TD align="number">{rp(ty.plafon)}</TD>
            <TD align="number">{rp(ty.used)}</TD>
            <TD align="number">{rp(ty.remaining)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[rp(data.sum.plafon), rp(data.sum.used), rp(data.sum.remaining)]} spanLabel={2} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Saldo dihitung dari dataMedicalBalance tahun buku — plafon efektif = benefit kebijakan + penyesuaian + bawa periode lalu. Kolom rupiah tersembunyi saat Brankas Uang terkunci.", "Balances are computed from dataMedicalBalance for the benefit year — effective limit = policy benefit + adjustment + carry-over. Rupiah columns are hidden while the Money Vault is locked.")} />
    </ReportSheet>
  );
}

// ================= MR1.2 Top Medical Limit Utilizers Alert Sheet =================
export function MR12View({ data, meta }: { data: MR12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr12" landscape>
      <DocHeader meta={meta} reportNo="R1.2" title="Top Medical Limit Utilizers Alert Sheet" subtitle={t("Karyawan dengan sisa plafon kritis / hampir habis sebelum akhir tahun buku — urut paling kritis", "Employees with critical / near-exhausted remaining limits before the fiscal year ends — sorted most critical first")} audience={t("HR Benefit Officer · Atasan Langsung", "HR Benefit Officer · Line Managers")} docNo={mkDocNo("mr12", meta)} />

      <DocSection no="A" title={t("Sebaran Urgensi", "Urgency Distribution")} note={t("Ambang kritis: sisa plafon < 20% sebelum akhir tahun buku (kebijakan benefit perusahaan).", "Critical threshold: remaining limit < 20% before the benefit year ends (company benefit policy).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Saldo Kritis", "Total Critical Balances"), value: f.num(data.total), accent: true }]} />
        {data.counts.map((c) => (
          <SummaryBox key={c.urgency} className="grid-cols-1" items={[{ label: c.label, value: f.num(c.count) }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Sisa Kritis", "Total Critical Remaining"), value: rp(data.totalRemaining), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Daftar Utilizer Tertinggi (urut paling kritis)", "Top Utilizers (most critical first)")} note={t("Sisa ≤ 0 berarti plafon habis — klaim berikutnya ditolak otomatis oleh sistem.", "Remaining ≤ 0 means the limit is exhausted — subsequent claims are auto-rejected by the system.")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Jenis Benefit</TH>
        <TH align="number">Plafon</TH><TH align="number">Terpakai</TH><TH align="number">Sisa Saldo</TH>
        <TH align="number">% Sisa</TH><TH align="number">Klaim (n)</TH><TH align="center">Urgensi</TH>
      </>}>
        {data.items.map((i, idx) => (
          <tr key={`${i.employeeNo}-${i.typeCode}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.urgency === "exhausted" && "bg-red-50/50")}>
            <TD align="center" className="text-slate-400">{idx + 1}</TD>
            <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{i.name}</TD>
            <TD>{i.unit ?? <Dash />}</TD>
            <TD className="text-[9.5px]">{i.typeName}</TD>
            <TD align="number">{rp(i.plafon)}</TD>
            <TD align="number">{rp(i.used)}</TD>
            <TD align="number" className="font-black text-red-700">{rp(i.remaining)}</TD>
            <TD align="number" className={cn("font-black", i.remainingPct <= 5 ? "text-red-600" : "text-slate-900")}>{f.pct(i.remainingPct)}</TD>
            <TD align="number">{f.num(i.claimCount)}</TD>
            <TD align="center"><DocBadge tone={BALANCE_TONE[i.urgency] ?? "slate"}>{t(...(BALANCE_LABEL[i.urgency] ?? [i.urgency, i.urgency]))}</DocBadge></TD>
          </tr>
        ))}
        {data.items.length === 0 && (
          <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada saldo kritis — semua plafon aman 🎉", "No critical balances — all limits are safe 🎉")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.total} ${t("karyawan", "employees")}`} cells={[""]} spanLabel={10} />
      </DocTable>

      <DocSection no="C" title={t("Rekomendasi Tindak Lanjut", "Recommended Follow-up")} />
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] leading-relaxed text-amber-800">
        {t(
          "1) Komunikasikan sisa plafon kepada karyawan terdampal (ESS / surel resmi) agar perawatan mendatang dapat direncanakan; 2) pertimbangkan penyesuaian plafon (Medical Adjustment) hanya dgn persetujuan C&B; 3) edukasi bahwa klaim di atas sisa plafon akan ditolak otomatis oleh sistem.",
          "1) Communicate the remaining limit to affected employees (ESS / official email) so future treatment can be planned; 2) consider a limit adjustment (Medical Adjustment) only with C&B approval; 3) educate that claims above the remaining limit are automatically rejected by the system.",
        )}
      </p>

      <DocFooter meta={meta} signNote={t("Ambang kritis < 20% sisa plafon sebelum akhir tahun buku (kebijakan benefit perusahaan). Sisa ≤ 0 = plafon habis — klaim berikutnya ditolak otomatis oleh sistem.", "Critical threshold < 20% remaining limit before the benefit year ends (company benefit policy). Remaining ≤ 0 = limit exhausted — subsequent claims are auto-rejected by the system.")} />
    </ReportSheet>
  );
}

// ================= MR1.3 Medical Benefit Liability =================
export function MR13View({ data, meta }: { data: MR13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const sumEmp = data.byType.reduce((s, x) => s + x.employees, 0);
  return (
    <ReportSheet docId="mr13">
      <DocHeader meta={meta} reportNo="R1.3" title="Medical Benefit Liability Report" subtitle={t("Proyeksi liabilitas biaya medis perusahaan — sisa plafon × porsi perusahaan", "Company medical cost liability projection — remaining limits × company share")} audience={t("Finance/Accounting · Direksi · Auditor", "Finance/Accounting · Directorate · Auditor")} docNo={mkDocNo("mr13", meta)} />

      <DocSection no="A" title={t("Ringkasan Liabilitas", "Liability Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employees"), value: f.num(data.headcount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Sisa Plafon", "Total Remaining Limit"), value: rp(data.totalRemaining) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Liabilitas", "Total Liability"), value: rp(data.totalLiability), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dasar", "Basis"), value: t("Sisa × % Perusahaan", "Remaining × Company %") }]} />
      </div>
      {data.masked && <MaskedBanner />}

      <DocSection no="B" title={t("Liabilitas per Jenis Benefit", "Liability per Benefit Type")} note={t("Liabilitas = sisa plafon × porsi perusahaan (pctCompany per jenis benefit).", "Liability = remaining limit × company share (pctCompany per benefit type).")} />
      <DocTable head={<>
        <TH>Jenis Benefit</TH><TH align="number">% Perusahaan</TH><TH align="number">Karyawan</TH>
        <TH align="number">Plafon</TH><TH align="number">Terpakai</TH><TH align="number">Sisa</TH><TH align="number">Liabilitas</TH>
      </>}>
        {data.byType.map((x) => (
          <tr key={x.typeCode} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{x.typeName}</TD>
            <TD align="number">{f.pct(x.pctCompany)}</TD>
            <TD align="number">{f.num(x.employees)}</TD>
            <TD align="number">{rp(x.plafon)}</TD>
            <TD align="number">{rp(x.used)}</TD>
            <TD align="number">{rp(x.remaining)}</TD>
            <TD align="number" className="font-black text-slate-900">{rp(x.liability)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(sumEmp),
          rp(sumMoney(data.byType, (x) => x.plafon)),
          rp(sumMoney(data.byType, (x) => x.used)),
          rp(sumMoney(data.byType, (x) => x.remaining)),
          rp(sumMoney(data.byType, (x) => x.liability)),
        ]} spanLabel={2} />
      </DocTable>

      <DocSection no="C" title={t("Liabilitas per Unit Kerja", "Liability per Work Unit")} />
      <DocTable head={<>
        <TH>Unit Kerja</TH><TH align="number">Karyawan</TH><TH align="number">Sisa</TH><TH align="number">Liabilitas</TH>
      </>}>
        {data.byUnit.map((u) => (
          <tr key={u.unit} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{u.unit}</TD>
            <TD align="number">{f.num(u.employees)}</TD>
            <TD align="number">{rp(u.remaining)}</TD>
            <TD align="number" className="font-black">{rp(u.liability)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(data.byUnit.reduce((s, u) => s + u.employees, 0)),
          rp(sumMoney(data.byUnit, (u) => u.remaining)),
          rp(sumMoney(data.byUnit, (u) => u.liability)),
        ]} spanLabel={1} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Proyeksi liabilitas = sisa plafon × porsi perusahaan (pctCompany per jenis benefit) — kebutuhan akrual anggaran reimbursement internal Finance. Nilai bruto sebelum potensi hangus akhir tahun.", "Liability projection = remaining limit × company share (pctCompany per benefit type) — accrual needs for Finance internal reimbursement budgeting. Gross values before potential year-end forfeiture.")} />
    </ReportSheet>
  );
}

// ================= MR2.1 Detailed Medical Reimbursement Register =================
export function MR21View({ data, meta }: { data: MR21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr21" landscape>
      <DocHeader meta={meta} reportNo="R2.1" title="Detailed Medical Reimbursement Register" subtitle={t("Log klaim per baris perawatan: tanggal kwitansi, pasien, jenis perawatan, diagnosis, dokter/RS, nominal klaim vs disetujui", "Claim log per treatment line: receipt date, patient, treatment type, diagnosis, physician/hospital, claimed vs approved amounts")} audience={t("HR Benefit · Finance · Auditor Internal", "HR Benefit · Finance · Internal Audit")} docNo={mkDocNo("mr21", meta)} />

      <DocSection no="A" title={t("Ringkasan Klaim", "Claim Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris Perawatan", "Treatment Lines"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dokumen Klaim", "Claim Documents"), value: f.num(data.claims) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Unik", "Unique Employees"), value: f.num(data.uniqueEmployees) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tagihan", "Total Billed"), value: rp(data.sum.bill) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Disetujui", "Total Approved"), value: rp(data.sum.approved), accent: true }]} />
        {data.byState.map((s) => (
          <SummaryBox key={s.state} className="grid-cols-1" items={[{ label: s.label, value: f.num(s.count) }]} />
        ))}
      </div>

      <DocSection no="B" title={t("Register Rincian Klaim (urut tanggal klaim)", "Claim Detail Register (by claim date)")} note={t("Setiap baris = satu baris perawatan/kwitansi (MedicalClaimLine); nominal disetujui mengikuti keputusan klaim induk.", "Each row = one treatment/receipt line (MedicalClaimLine); approved amounts follow the parent claim decision.")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>Jenis Benefit</TH><TH align="center">Tgl Klaim</TH><TH align="center">Tgl Kwitansi</TH>
              <TH>Pasien</TH><TH>Perawatan / Diagnosis</TH><TH>Dokter · RS</TH>
              <TH align="number">Tagihan</TH><TH align="number">Disetujui</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.docNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD className="text-[9.5px]">{i.typeName}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD align="center">{f.dt(i.receiptDate)}</TD>
                <TD className="font-semibold text-slate-800">
                  {i.patient}
                  {i.dependent && <span className="ml-1 rounded bg-slate-100 px-1 py-px text-[8px] font-bold text-slate-500">dep.</span>}
                </TD>
                <TD className="max-w-44 text-[9.5px] text-slate-600">{i.treatment ?? <Dash />}</TD>
                <TD className="text-[9.5px]">{[i.physician, i.hospital].filter((x): x is string => !!x).join(" · ") || <Dash />}</TD>
                <TD align="number">{rp(i.bill)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.approved)}</TD>
                <TD align="center"><DocBadge tone={STATUS_TONE[i.state] ?? "slate"}>{t(...(STATUS_LABEL[i.state] ?? [i.state, i.state]))}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={14} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada klaim pada rentang / filter ini.", "No claims for this range / filter.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.claims} ${t("dokumen", "documents")} / ${data.total} ${t("baris", "rows")}`} cells={[
              rp(data.sum.bill), rp(data.sum.approved), "",
            ]} spanLabel={11} />
          </tbody>
        </table>
      </div>

      {data.byState.length > 1 && (
        <>
          <DocSection no="C" title={t("Sebaran Status Klaim", "Claim Status Distribution")} />
          <DocTable head={<><TH>Status</TH><TH align="number">Jumlah</TH></>}>
            {data.byState.map((s) => (
              <tr key={s.state} className="hover:bg-slate-50">
                <TD><DocBadge tone={STATUS_TONE[s.state] ?? "slate"}>{t(...(STATUS_LABEL[s.state] ?? [s.label, s.label]))}</DocBadge></TD>
                <TD align="number">{f.num(s.count)}</TD>
              </tr>
            ))}
            <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.claims)]} spanLabel={1} />
          </DocTable>
        </>
      )}

      <DocFooter meta={meta} signNote={t("Register rincian klaim — setiap baris = satu baris perawatan/kwitansi (MedicalClaimLine). Nominal disetujui final mengikuti keputusan persetujuan klaim induk.", "Detailed claim register — each row is one treatment/receipt line (MedicalClaimLine). Final approved amounts follow the parent claim approval decision.")} />
    </ReportSheet>
  );
}

// ================= MR2.2 Pending Claims & Verification Pipeline =================
export function MR22View({ data, meta }: { data: MR22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const SLA_TONE: Record<string, "red" | "amber" | "green"> = { overdue: "red", "due-soon": "amber", "on-track": "green" };
  return (
    <ReportSheet docId="mr22" landscape>
      <DocHeader meta={meta} reportNo="R2.2" title="Pending Claims & Verification Pipeline" subtitle={t("Klaim tertahan menunggu verifikasi dokumen fisik — kwitansi & surat rujukan", "Held claims awaiting physical document verification — receipts & referral letters")} audience={t("HR Benefit Officer · Verifikator Dokumen", "HR Benefit Officer · Document Verifiers")} docNo={mkDocNo("mr22", meta)} />

      <DocSection no="A" title={t("Ringkasan SLA", "SLA Summary")} note={t("SLA verifikasi dokumen fisik: 3 hari kerja (kebijakan medical).", "Physical document verification SLA: 3 working days (medical policy).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tertahan", "Total On Hold"), value: f.num(data.total), accent: true }]} />
        {data.counts.map((c) => (
          <SummaryBox key={c.state} className="grid-cols-1" items={[{ label: c.label, value: f.num(c.count) }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Terlama", "Longest Waiting"), value: `${f.num(data.oldestWaiting)} ${t("hari", "days")}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dokumen Kurang", "Docs Missing"), value: f.num(data.docsMissing), accent: data.docsMissing > 0 }]} />
      </div>

      <DocSection no="B" title={t("Antrian Verifikasi (urut menunggu terlama)", "Verification Queue (longest waiting first)")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>Jenis Benefit</TH><TH align="center">Tgl Klaim</TH><TH align="number">Menunggu (hari)</TH>
              <TH align="center">SLA</TH><TH align="center">Kwitansi</TH><TH align="center">Surat Rujukan</TH>
              <TH align="center">Siap Verifikasi</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.sla === "overdue" && "bg-red-50/50")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD className="text-[9.5px]">{i.typeName}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD align="number" className={cn("font-black", i.waitingDays > 3 ? "text-red-600" : i.waitingDays >= 2 ? "text-amber-600" : "text-slate-900")}>{f.num(i.waitingDays)}</TD>
                <TD align="center">
                  <DocBadge tone={SLA_TONE[i.sla] ?? "slate"}>
                    {i.sla === "overdue" ? t("Melewati SLA", "Over SLA") : i.sla === "due-soon" ? t("Mendekati SLA", "Due Soon") : t("Normal", "On Track")}
                  </DocBadge>
                </TD>
                <TD align="center">
                  {i.needReceipt ? (
                    <DocBadge tone={i.receiptComplete ? "green" : "red"}>{i.receiptComplete ? t("Lengkap", "Complete") : t("Kosong", "Missing")}</DocBadge>
                  ) : <span className="text-slate-300">—</span>}
                </TD>
                <TD align="center">
                  {i.needLetter ? (
                    <DocBadge tone={i.letterComplete ? "green" : "red"}>{i.letterComplete ? t("Lengkap", "Complete") : t("Kosong", "Missing")}</DocBadge>
                  ) : <span className="text-slate-300">—</span>}
                </TD>
                <TD align="center">
                  <DocBadge tone={i.readyToVerify ? "green" : "amber"}>{i.readyToVerify ? t("Siap", "Ready") : t("Perlu Dokumen", "Docs Needed")}</DocBadge>
                </TD>
                <TD align="center"><DocBadge tone={STATUS_TONE[i.state] ?? "slate"}>{t(...(STATUS_LABEL[i.state] ?? [i.state, i.state]))}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={13} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada klaim tertahan 🎉", "No held claims 🎉")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("klaim tertahan", "held claims")}`} cells={[""]} spanLabel={12} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("SLA verifikasi dokumen fisik: 3 hari kerja (kebijakan medical). Klaim Approved belum settle ikut diawasi hingga jurnal settlement dibuat.", "Physical document verification SLA: 3 working days (medical policy). Approved-unsettled claims remain monitored until the settlement journal is created.")} />
    </ReportSheet>
  );
}

// ================= MR2.3 Family Dependent Claim Summary =================
export function MR23View({ data, meta }: { data: MR23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr23" landscape>
      <DocHeader meta={meta} reportNo="R2.3" title="Family Dependent Claim Summary" subtitle={t("Rekap biaya medis anggota keluarga yang ditanggung perusahaan — pasangan/anak, per karyawan dengan hubungan keluarga", "Company-borne family member medical recap — spouse/children, per employee with family relationship")} audience={t("HR · Finance · Manajemen", "HR · Finance · Management")} docNo={mkDocNo("mr23", meta)} />

      <DocSection no="A" title={t("Ringkasan Klaim Tanggungan", "Dependent Claim Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employees"), value: f.num(data.employees), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris Perawatan", "Treatment Lines"), value: f.num(data.total) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tagihan", "Total Billed"), value: rp(data.sum.bill) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Disetujui", "Total Approved"), value: rp(data.sum.approved), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Register Klaim Tanggungan (urut tanggal klaim)", "Dependent Claim Register (by claim date)")} note={t("Hubungan keluarga dicocokkan dari data keluarga karyawan (EmployeeFamily) — Tanggungan bila tidak ditemukan.", "Family relations are matched from employee family data (EmployeeFamily) — Dependent when not found.")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama Karyawan</TH><TH>Unit</TH>
              <TH>Pasien (Tanggungan)</TH><TH align="center">Hubungan</TH><TH>Jenis Benefit</TH>
              <TH align="center">Tgl Klaim</TH><TH>Perawatan</TH>
              <TH align="number">Tagihan</TH><TH align="number">Disetujui</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.docNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD className="font-semibold text-slate-800">{i.patient}</TD>
                <TD align="center">{i.relation}</TD>
                <TD className="text-[9.5px]">{i.typeName}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD className="max-w-40 text-[9.5px] text-slate-600">
                  {i.treatment ?? <Dash />}
                  {(i.physician || i.hospital) && (
                    <span className="block text-[8.5px] text-slate-400">{[i.physician, i.hospital].filter((x): x is string => !!x).join(" · ")}</span>
                  )}
                </TD>
                <TD align="number">{rp(i.bill)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.approved)}</TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada klaim tanggungan pada rentang ini.", "No dependent claims in this range.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("baris perawatan", "treatment lines")}`} cells={[
              rp(data.sum.bill), rp(data.sum.approved),
            ]} spanLabel={10} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Rekap per Karyawan", "Recap per Employee")} />
      <DocTable head={<>
        <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
        <TH align="number">Klaim</TH><TH align="number">Tagihan</TH><TH align="number">Disetujui</TH>
      </>}>
        {data.byEmployee.map((e) => (
          <tr key={e.employeeNo} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{e.name}</TD>
            <TD>{e.unit ?? <Dash />}</TD>
            <TD align="number">{f.num(e.claims)}</TD>
            <TD align="number">{rp(e.bill)}</TD>
            <TD align="number" className="font-black">{rp(e.approved)}</TD>
          </tr>
        ))}
        {data.byEmployee.length === 0 && (
          <tr><TD colSpan={6} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada data.", "No data.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.employees} ${t("karyawan", "employees")}`} cells={[
          f.num(data.total), rp(data.sum.bill), rp(data.sum.approved),
        ]} spanLabel={3} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Klaim tanggungan mengikuti kebijakan dependent per jenis benefit (maks dependents & batas usia anak). Hubungan keluarga dicocokkan dari data keluarga karyawan (EmployeeFamily) — Tanggungan bila tidak ditemukan.", "Dependent claims follow the dependent policy per benefit type (max dependents & child age limits). Family relations are matched from employee family data (EmployeeFamily) — labeled Dependent when not found.")} />
    </ReportSheet>
  );
}
