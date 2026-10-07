"use client";
// T112 — views dokumen Leave Grup 1 (Saldo & Hak) + Grup 2 (Transaksi) =========
// Komponen dasar (ReportSheet/DocHeader/DocFooter/…) dipakai bersama dari
// doc-kit modul HR — murni presentasional, tipe DocMeta identik struktural.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type { DocMeta, LR11Data, LR12Data, LR13Data, LR21Data, LR22Data, LR23Data } from "./types";

/** No. dokumen deterministik: LV/LR11/2026/10. */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `LV/${id.slice(1).toUpperCase()}/${meta.year}/${mm}`;
}

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Approved: "green", Submitted: "amber", Rejected: "red", Cancelled: "slate", MassLeave: "sky",
};
const STATUS_LABEL: Record<string, [string, string]> = {
  Approved: ["Disetujui", "Approved"], Submitted: ["Menunggu Persetujuan", "Pending Approval"],
  Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"], MassLeave: ["Cuti Massal", "Mass Leave"],
};
const URGENCY_TONE: Record<string, "red" | "amber" | "violet" | "sky" | "green"> = {
  overdue: "red", critical: "red", warning: "amber", caution: "violet", safe: "green",
};
const URGENCY_LABEL: Record<string, [string, string]> = {
  overdue: ["Lewat Jatuh Tempo", "Overdue"], critical: ["Kritis (< 30 hari)", "Critical (< 30 days)"],
  warning: ["Perhatian (30 – 60 hari)", "Warning (30 – 60 days)"], caution: ["Waspada (60 – 90 hari)", "Caution (60 – 90 days)"],
  safe: ["Aman (> 90 hari)", "Safe (> 90 days)"],
};
const SESSION_LABEL: Record<string, [string, string]> = { AM: ["Pagi", "AM"], PM: ["Sore", "PM"] };

// ================= LR1.1 Annual Leave Balance =================
export function LR11View({ data, meta }: { data: LR11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const u = data.isMonth ? t("bln", "mo") : t("hr", "d");
  return (
    <ReportSheet docId="lr11" landscape>
      <DocHeader meta={meta} reportNo="R1.1" title="Annual Leave Balance Report" subtitle={t("Saldo Cuti Karyawan Aktif — Active Employee Leave Balances", "Active Employee Leave Balances")} audience={t("HR · Karyawan (self-service) · Atasan", "HR · Employees (self-service) · Line Managers")} docNo={mkDocNo("lr11", meta)} />

      <DocSection no="A" title={t("Ringkasan Saldo", "Balance Summary")} note={`${data.typeName} — formula: (a) bawa + (b) diperoleh + (c) penyesuaian − (d) hangus − (e) diuangkan − (f) diambil − (g) terpasang = sisa.`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employees"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t(`Bawa (a) ${u}`, `Carried (a)`), value: f.num(data.sum.carriedOver) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t(`Diperoleh (b) ${u}`, `Earned (b)`), value: f.num(data.sum.earned) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t(`Diambil (f) ${u}`, `Taken (f)`), value: f.num(data.sum.taken) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t(`Terpasang (g) ${u}`, `Applied (g)`), value: f.num(data.sum.applied) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t(`Sisa Saldo ${u}`, `Remaining`), value: f.num(data.sum.remaining), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Saldo Habis", "Zero Balance"), value: f.num(data.zeroRemaining) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Saldo per Karyawan (urut Unit & No.)", "Balance Register (by Unit & No.)")} note={t("Diambil = cuti berlalu s.d. hari ini; Terpasang = cuti disetujui hari ini & mendatang.", "Taken = past leave as of today; Applied = approved today & onward.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama Lengkap</TH><TH>Unit / Departemen</TH>
              <TH align="center">Status</TH><TH align="center">Tgl Masuk</TH>
              <TH align="number">Hak (bruto)</TH>
              <TH align="number">Bawa (a)</TH><TH align="number">Diperoleh (b)</TH><TH align="number">Penyesuaian (c)</TH>
              <TH align="number">Diambil (f)</TH><TH align="number">Terpasang (g)</TH><TH align="number">Diuangkan (e)</TH>
              <TH align="number">Sisa Saldo</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="center">{r.employmentStatus}</TD>
                <TD align="center">{f.dt(r.joinDate)}</TD>
                <TD align="number">{f.num(r.entitlement)}</TD>
                <TD align="number">{r.carriedOver || <Dash />}</TD>
                <TD align="number">{r.earned || <Dash />}</TD>
                <TD align="number">{r.adjustment ? (r.adjustment > 0 ? `+${r.adjustment}` : r.adjustment) : <Dash />}</TD>
                <TD align="number">{r.taken || <Dash />}</TD>
                <TD align="number">{r.applied || <Dash />}</TD>
                <TD align="number">{r.cashed || <Dash />}</TD>
                <TD align="number" className={cn("font-black", r.remaining <= 0 ? "text-red-600" : "text-slate-900")}>{f.num(r.remaining)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <DocTable head={<>
          <TH>TOTAL {data.total} KARYAWAN</TH>
          <TH align="number">Hak</TH><TH align="number">Bawa (a)</TH><TH align="number">Diperoleh (b)</TH>
          <TH align="number">Penyesuaian (c)</TH><TH align="number">Diambil (f)</TH><TH align="number">Terpasang (g)</TH>
          <TH align="number">Diuangkan (e)</TH><TH align="number">Sisa Saldo</TH>
        </>}>
          <TotalRow label={`TOTAL — ${data.total} ${t("karyawan", "employees")}`} cells={[
            f.num(data.rows.reduce((s, r) => s + r.entitlement, 0)),
            f.num(data.sum.carriedOver), f.num(data.sum.earned), f.num(data.sum.adjustment),
            f.num(data.sum.taken), f.num(data.sum.applied), f.num(data.sum.cashed), f.num(data.sum.remaining),
          ]} spanLabel={1} />
        </DocTable>
      </div>

      <DocFooter meta={meta} signNote={t("Saldo dihitung dinamis per tanggal cetak — termasuk pengajuan disetujui yang belum berlaku.", "Balances are computed dynamically as of the print date — including approved requests not yet effective.")} />
    </ReportSheet>
  );
}

// ================= LR1.2 Leave Expiry & Forfeiture =================
export function LR12View({ data, meta }: { data: LR12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr12" landscape>
      <DocHeader meta={meta} reportNo="R1.2" title="Leave Expiry & Forfeiture Alert Sheet" subtitle={t(`Daftar Saldo Bawa Mendekati Batas Hangus — 31 Desember ${data.year}`, `Carry-Over Balances Approaching Forfeiture — December 31, ${data.year}`)} audience={t("HR · Karyawan · Atasan Langsung", "HR · Employees · Line Managers")} docNo={mkDocNo("lr12", meta)} />

      <DocSection no="A" title={t("Sebaran Urgensi", "Urgency Distribution")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Saldo Bawa Aktif", "Active Carry-Overs"), value: f.num(data.total), accent: true }]} />
        {data.counts.map((c) => (
          <SummaryBox key={c.urgency} className="grid-cols-1" items={[{ label: t(...URGENCY_LABEL[c.urgency]), value: f.num(c.count) }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Potensi Hangus (hr)", "Total Potential Forfeit (d)"), value: f.num(data.totalPotentialForfeit), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Daftar Saldo Bawa & Batas Hangus", "Carry-Over & Forfeiture Deadline Register")} note={t("Potensi hangus = min(saldo bawa, sisa saldo) — pemakaian mengurangi bawa terlebih dahulu (FIFO).", "Potential forfeit = min(carried-over, remaining) — usage deducts from carry-over first (FIFO).")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Jenis Cuti</TH>
        <TH align="number">Batas Bawa</TH><TH align="number">Dibawa (a)</TH><TH align="number">Sisa Saldo</TH>
        <TH align="number">Potensi Hangus</TH><TH align="center">Tanggal Hangus</TH><TH align="number">Sisa Hari</TH><TH align="center">Urgensi</TH>
      </>}>
        {data.items.map((i, idx) => (
          <tr key={i.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{idx + 1}</TD>
            <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{i.name}</TD>
            <TD>{i.unit ?? <Dash />}</TD>
            <TD className="text-[9.5px]">{i.leaveType}</TD>
            <TD align="number">{f.num(i.carryOverMax)}</TD>
            <TD align="number">{f.num(i.carriedOver)}</TD>
            <TD align="number">{f.num(i.remaining)}</TD>
            <TD align="number" className="font-bold text-red-700">{f.num(i.potentialForfeit)}</TD>
            <TD align="center">{f.dt(i.forfeitDate)}</TD>
            <TD align="number" className={cn(i.daysRemaining < 30 && "font-black text-red-600")}>{f.num(i.daysRemaining)}</TD>
            <TD align="center"><DocBadge tone={URGENCY_TONE[i.urgency]}>{t(...URGENCY_LABEL[i.urgency])}</DocBadge></TD>
          </tr>
        ))}
        <TotalRow label={`TOTAL — ${data.total} ${t("saldo bawa", "carry-overs")}`} cells={[
          "", f.num(data.totalCarried), "", f.num(data.totalPotentialForfeit), "", "", "",
        ]} spanLabel={5} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Sesuai UU 13/2003 Ps.79 — sisa cuti dapat dibawa maksimal 6 bulan ke periode berikutnya (kebijakan perusahaan: carry-over hangus 31 Desember).", "Per Law 13/2003 Art.79 — remaining leave may be carried max 6 months (company policy: carry-over expires Dec 31).")} />
    </ReportSheet>
  );
}

// ================= LR1.3 Leave Liability =================
export function LR13View({ data, meta }: { data: LR13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const rp = (n: number | null) => (n == null ? <span className="text-slate-300">{"•••"}</span> : `Rp ${n.toLocaleString("id-ID")}`);
  return (
    <ReportSheet docId="lr13" landscape>
      <DocHeader meta={meta} reportNo="R1.3" title="Leave Liability Report" subtitle={t("Liabilitas Keuangan Saldo Cuti Belum Diambil — Financial Liability of Untaken Leave", "Financial Liability of Untaken Leave")} audience={t("Finance/Accounting · Direksi · Auditor", "Finance/Accounting · Directorate · Auditor")} docNo={mkDocNo("lr13", meta)} />

      <DocSection no="A" title={t("Ringkasan Liabilitas", "Liability Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan dgn Saldo", "Employees w/ Balance"), value: f.num(data.totalEmployees), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Sisa Saldo (hari)", "Total Remaining (days)"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Liabilitas (Rp)", "Total Liability (Rp)"), value: data.totalLiability != null ? `Rp ${data.totalLiability.toLocaleString("id-ID")}` : "•••", accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dasar Estimasi", "Estimate Basis"), value: t("Gaji pokok ÷ 21", "Base salary ÷ 21") }]} />
      </div>

      {data.masked && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
          {t("⚠ Brankas uang terkunci — nilai rupiah disembunyikan (•••). Buka Brankas Uang untuk menampilkan nilai liabilitas.", "⚠ Money vault locked — rupiah values hidden (•••). Open the Money Vault to reveal liability values.")}
        </p>
      )}

      <DocSection no="B" title={t("Rincian Liabilitas per Karyawan", "Liability Detail per Employee")} note={t("Liabilitas = sisa saldo × estimasi upah harian (gaji pokok ÷ 21 hari kerja).", "Liability = remaining balance × estimated daily rate (base salary ÷ 21 workdays).")} />
      <div className="doc-scroll max-h-[480px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="center">Status</TH>
              <TH align="number">Sisa Saldo (hari)</TH><TH align="number">Gaji Pokok (Rp/bln)</TH>
              <TH align="number">Upah Harian (Rp)</TH><TH align="number">Liabilitas (Rp)</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center">{i.employmentStatus}</TD>
                <TD align="number" className="font-bold">{f.num(i.remaining)}</TD>
                <TD align="number">{rp(i.monthlySalary)}</TD>
                <TD align="number">{rp(i.dailyRate)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.liability)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("5 Liabilitas Terbesar", "Top 5 Liabilities")} />
      <DocTable head={<><TH>No. Karyawan</TH><TH>Nama</TH><TH align="number">Sisa (hari)</TH><TH align="number">Liabilitas (Rp)</TH></>}>
        {data.top5.map((i) => (
          <tr key={i.employeeNo} className="hover:bg-slate-50">
            <TD className="font-bold">{i.employeeNo}</TD><TD>{i.name}</TD>
            <TD align="number">{f.num(i.remaining)}</TD>
            <TD align="number" className="font-black">{rp(i.liability)}</TD>
          </tr>
        ))}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Estimasi utk kebutuhan akrual akuntansi — bukan komitmen pembayaran tunai; uang pengganti cuti hanya melalui modul encashment.", "Estimate for accounting accrual — not a cash payment commitment; leave encashment only via the encashment module.")} />
    </ReportSheet>
  );
}

// ================= LR2.1 Detailed Leave Activity Log =================
export function LR21View({ data, meta }: { data: LR21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr21" landscape>
      <DocHeader meta={meta} reportNo="R2.1" title="Detailed Leave Activity Log" subtitle={t("Riwayat Pengajuan Cuti per Karyawan — Leave Request History", "Leave Request History")} audience={t("HR · Auditor Internal", "HR · Internal Audit")} docNo={mkDocNo("lr21", meta)} />

      <DocSection no="A" title={t("Ringkasan Aktivitas", "Activity Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Pengajuan", "Total Requests"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari Kerja", "Total Working Days"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Unik", "Unique Employees"), value: f.num(data.uniqueEmployees) }]} />
        {data.byStatus.map((s) => (
          <SummaryBox key={s.status} className="grid-cols-1" items={[{ label: s.label, value: f.num(s.count) }]} />
        ))}
      </div>

      <DocSection no="B" title={t("Log Aktivitas (urut tanggal mulai terbaru)", "Activity Log (latest start first)")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Jenis Cuti</TH>
              <TH align="center">Mulai</TH><TH align="center">Selesai</TH><TH align="number">Hari</TH>
              <TH align="center">Status</TH><TH>Alasan</TH><TH align="center">Sumber</TH><TH>Pemutus</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD className="text-[9.5px]">{i.leaveType}</TD>
                <TD align="center">{f.dt(i.dateFrom)}<span className="text-slate-400"> {t(...(SESSION_LABEL[i.sessionFrom] ?? SESSION_LABEL.AM))}</span></TD>
                <TD align="center">{f.dt(i.dateTo)}<span className="text-slate-400"> {t(...(SESSION_LABEL[i.sessionTo] ?? SESSION_LABEL.PM))}</span></TD>
                <TD align="number" className="font-bold">{f.num(i.workingDays)}</TD>
                <TD align="center"><DocBadge tone={STATUS_TONE[i.status] ?? "slate"}>{t(...(STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
                <TD className="max-w-44 text-[9.5px] text-slate-600">{i.reason ?? <Dash />}</TD>
                <TD align="center"><span className="rounded bg-slate-100 px-1 py-px text-[8.5px] font-bold text-slate-500">{i.source}</span></TD>
                <TD className="text-[9.5px]">{i.decidedBy ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Termasuk seluruh status pengajuan (disetujui, menunggu, ditolak, dibatalkan) pada rentang tanggal terpilih.", "Includes all request statuses (approved, pending, rejected, cancelled) within the selected range.")} />
    </ReportSheet>
  );
}

// ================= LR2.2 Leave Approval Pipeline =================
export function LR22View({ data, meta }: { data: LR22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const SLA_TONE: Record<string, "red" | "amber" | "green"> = { overdue: "red", "due-soon": "amber", "on-track": "green" };
  return (
    <ReportSheet docId="lr22">
      <DocHeader meta={meta} reportNo="R2.2" title="Leave Approval Pipeline" subtitle={t("Pengajuan Menunggu Persetujuan Atasan — Requests Pending Approval", "Requests Pending Approval")} audience={t("HR · Atasan Langsung", "HR · Line Managers")} docNo={mkDocNo("lr22", meta)} />

      <DocSection no="A" title={t("Ringkasan SLA", "SLA Summary")} note={t("SLA internal: keputusan persetujuan maksimal 3 hari kerja setelah diajukan.", "Internal SLA: approval decision within 3 working days after submission.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Persetujuan", "Pending Approvals"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari Cuti Terkunci", "Total Leave Days On Hold"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Terlama", "Longest Waiting"), value: `${f.num(data.oldestWaiting)} ${t("hari", "days")}` }]} />
        {data.counts.map((c) => (
          <SummaryBox key={c.sla} className="grid-cols-1" items={[{ label: c.label, value: f.num(c.count) }]} />
        ))}
      </div>

      <DocSection no="B" title={t("Antrian Persetujuan (urut menunggu terlama)", "Approval Queue (longest waiting first)")} />
      <DocTable head={<>
        <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Jenis Cuti</TH>
        <TH align="center">Mulai</TH><TH align="center">Selesai</TH><TH align="number">Hari</TH>
        <TH align="center">Diajukan</TH><TH align="number">Menunggu (hari)</TH><TH align="center">SLA</TH><TH>Alasan</TH>
      </>}>
        {data.items.map((i) => (
          <tr key={i.docNo} className="hover:bg-slate-50">
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
            <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{i.name}</TD>
            <TD>{i.unit ?? <Dash />}</TD>
            <TD className="text-[9.5px]">{i.leaveType}</TD>
            <TD align="center">{f.dt(i.dateFrom)}</TD>
            <TD align="center">{f.dt(i.dateTo)}</TD>
            <TD align="number">{f.num(i.workingDays)}</TD>
            <TD align="center">{f.dt(i.requestDate)}</TD>
            <TD align="number" className={cn("font-black", i.waitingDays > 7 ? "text-red-600" : i.waitingDays > 3 ? "text-amber-600" : "text-slate-900")}>{f.num(i.waitingDays)}</TD>
            <TD align="center">
              <DocBadge tone={SLA_TONE[i.sla]}>
                {i.sla === "overdue" ? t("Lewat SLA", "Over SLA") : i.sla === "due-soon" ? t("Mendekati SLA", "Due Soon") : t("Normal", "On Track")}
              </DocBadge>
            </TD>
            <TD className="max-w-40 text-[9.5px] text-slate-600">{i.reason ?? <Dash />}</TD>
          </tr>
        ))}
        {data.items.length === 0 && (
          <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada pengajuan menunggu persetujuan 🎉", "No requests pending approval 🎉")}</TD></tr>
        )}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Gunakan modul Persetujuan Cuti untuk memproses antrian ini — keputusan tercatat pada jejak audit.", "Process this queue via the Leave Approval module — decisions are recorded in the audit trail.")} />
    </ReportSheet>
  );
}

// ================= LR2.3 Departmental Leave Schedule =================
export function LR23View({ data, meta }: { data: LR23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr23" landscape>
      <DocHeader meta={meta} reportNo="R2.3" title="Departmental Leave Schedule" subtitle={t(`Rencana Cuti Departemen — ${data.month}`, `Department Leave Plans — ${data.month}`)} audience={t("Manajer Departemen · HR · Operations", "Department Managers · HR · Operations")} docNo={mkDocNo("lr23", meta)} />

      <DocSection no="A" title={t("Ringkasan Bulan", "Monthly Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rencana Cuti", "Leave Plans"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari Kerja", "Total Working Days"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Unit Terdampak", "Units Affected"), value: f.num(data.unitsAffected) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dgn Potensi Bentrok", "With Potential Conflict"), value: f.num(data.withConflicts) }]} />
      </div>

      <DocSection no="B" title={t("Jadwal per Departemen", "Schedule by Department")} note={t("Kolom Bentrok = rekan satu unit dengan rentang cuti beririsan — koordinasikan handover.", "Conflict column = same-unit colleagues with overlapping leave — coordinate handover.")} />
      {data.byUnit.map((u) => (
        <div key={u.unit} className="mb-4">
          <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-800">{u.unit}</p>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-[8.5px] font-bold text-slate-500">
              {f.num(u.employees)} {t("karyawan", "employees")} · {f.num(u.days)} {t("hari kerja", "working days")}
              {u.conflicts > 0 && <span className="ml-1 text-amber-600">· {f.num(u.conflicts)} {t("bentrok", "conflicts")}</span>}
            </span>
          </div>
          <DocTable head={<>
            <TH>No. Karyawan</TH><TH>Nama</TH><TH>Jenis Cuti</TH><TH align="center">Mulai</TH><TH align="center">Selesai</TH>
            <TH align="number">Hari</TH><TH align="center">Bentrok Unit</TH><TH align="center">Kembali Kerja</TH>
          </>}>
            {u.rows.map((r) => (
              <tr key={r.employeeNo + r.dateFrom} className="hover:bg-slate-50">
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD className="text-[9.5px]">{r.leaveType}</TD>
                <TD align="center">{f.dt(r.dateFrom)} <span className="text-slate-400">{t(...(SESSION_LABEL[r.sessionFrom] ?? SESSION_LABEL.AM))}</span></TD>
                <TD align="center">{f.dt(r.dateTo)} <span className="text-slate-400">{t(...(SESSION_LABEL[r.sessionTo] ?? SESSION_LABEL.PM))}</span></TD>
                <TD align="number">{f.num(r.workingDays)}</TD>
                <TD align="center">
                  {r.conflicts > 0
                    ? <span className="inline-flex items-center gap-1 font-black text-amber-700">⚠ {f.num(r.conflicts)}</span>
                    : <span className="text-slate-300">—</span>}
                </TD>
                <TD align="center">{f.dt(r.backToWork)}</TD>
              </tr>
            ))}
          </DocTable>
        </div>
      ))}
      {data.byUnit.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-[11px] font-bold text-slate-400">
          {t("Tidak ada cuti disetujui pada bulan ini.", "No approved leave this month.")}
        </div>
      )}

      <DocFooter meta={meta} signNote={t("Hanya pengajuan berstatus Disetuju & Cuti Massal — pengajuan menunggu lihat R2.2.", "Only Approved & Mass Leave requests — see R2.2 for pending ones.")} />
    </ReportSheet>
  );
}
