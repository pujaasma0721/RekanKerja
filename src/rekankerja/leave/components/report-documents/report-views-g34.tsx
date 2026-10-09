"use client";
// T112 — views dokumen Leave Grup 3 (Ketidakhadiran) + Grup 4 (Kepatuhan) ======
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import { mkDocNo } from "./report-views-g12";
import type { DocMeta, LR31Data, LR32Data, LR33Data, LR41Data, LR42Data, LR43Data } from "./types";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  Approved: "green", Submitted: "amber", Rejected: "red", Cancelled: "slate",
};
const STATUS_LABEL: Record<string, [string, string]> = {
  Approved: ["Disetujui", "Approved"], Submitted: ["Menunggu Persetujuan", "Pending Approval"],
  Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
};

// ================= LR3.1 Absenteeism Rate Summary =================
export function LR31View({ data, meta }: { data: LR31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr31" landscape>
      <DocHeader meta={meta} reportNo="R3.1" title="Absenteeism Rate Summary" subtitle={t(`Persentase Ketidakhadiran per Divisi — ${data.month}`, `Absence Rate per Division — ${data.month}`)} audience={t("Direksi · Manajemen Senior · HR", "Directorate · Senior Management · HR")} docNo={mkDocNo("lr31", meta)} />

      <DocSection no="A" title={t("Ringkasan Perusahaan", "Company Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Headcount Aktif", "Active Headcount"), value: f.num(data.total.headcount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hari Kerja Tercatat", "Recorded Workdays"), value: f.num(data.workdays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hadir (incl. terlambat)", "Present (incl. late)"), value: f.num(data.total.present) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Cuti", "On Leave"), value: f.num(data.total.onLeave) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Izin / Off", "Permission / Off"), value: f.num(data.total.workoff) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Alpa", "No-show"), value: f.num(data.total.absent) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Absenteeisme", "Absenteeism"), value: data.total.rate != null ? f.pct(data.total.rate) : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Rincian per Divisi", "Detail per Division")} note={t("Absenteeisme = (cuti + izin + alpa) ÷ (headcount × hari kerja). Kolom Alpa % = ketidakhadiran tak terencana.", "Absenteeism = (leave + permission + no-show) ÷ (headcount × workdays). Alpa % = unplanned absence.")} />
      <DocTable head={<>
        <TH>Divisi</TH><TH align="number">HC</TH><TH align="number">Hari Kerja</TH>
        <TH align="number">Hadir</TH><TH align="number">Cuti</TH><TH align="number">Izin/Off</TH><TH align="number">Alpa</TH>
        <TH align="number">Total Tidak Hadir</TH><TH align="number">Absenteeisme %</TH><TH align="number">Alpa %</TH>
      </>}>
        {data.rows.map((r, idx) => (
          <tr key={r.division} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{r.division}</TD>
            <TD align="number">{f.num(r.headcount)}</TD>
            <TD align="number">{f.num(r.workdays)}</TD>
            <TD align="number">{f.num(r.present)}</TD>
            <TD align="number">{f.num(r.onLeave)}</TD>
            <TD align="number">{f.num(r.workoff)}</TD>
            <TD align="number" className={cn(r.absent > 0 && "font-bold text-red-600")}>{f.num(r.absent)}</TD>
            <TD align="number" className="font-bold">{f.num(r.lostTotal)}</TD>
            <TD align="number" className="font-black">{r.rate != null ? f.pct(r.rate) : <Dash />}</TD>
            <TD align="number">{r.unplannedRate != null ? f.pct(r.unplannedRate) : <Dash />}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL PERUSAHAAN", "COMPANY TOTAL")} cells={[
          f.num(data.total.headcount), f.num(data.workdays), f.num(data.total.present),
          f.num(data.total.onLeave), f.num(data.total.workoff), f.num(data.total.absent),
          f.num(data.total.lostTotal), data.total.rate != null ? f.pct(data.total.rate) : "—",
          data.total.unplannedRate != null ? f.pct(data.total.unplannedRate) : "—",
        ]} spanLabel={1} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Cuti haid (R4.3) dan cuti melahirkan tidak dihitung sebagai absen menurut UU 13/2003 Ps.81/82 — lihat catatan kepatuhan.", "Menstrual (R4.3) and maternity leave are not counted as absence per Law 13/2003 Art.81/82 — see compliance note.")} />
    </ReportSheet>
  );
}

// ================= LR3.2 Sick Leave & SKD Audit =================
export function LR32View({ data, meta }: { data: LR32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr32" landscape>
      <DocHeader meta={meta} reportNo="R3.2" title="Sick Leave Tracking & SKD Audit" subtitle={t("Rekap Cuti Sakit + Kelengkapan Surat Keterangan Dokter (UU 13/2003 Ps.93)", "Sick Leave Recap + Medical Certificate Audit (Law 13/2003 Art.93)")} audience={t("HR · Payroll · Klinik Partner", "HR · Payroll · Partner Clinic")} docNo={mkDocNo("lr32", meta)} />

      <DocSection no="A" title={t("Ringkasan Audit", "Audit Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Kasus", "Total Cases"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari Sakit", "Total Sick Days"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Unik", "Unique Employees"), value: f.num(data.uniqueEmployees) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("SKD Lengkap", "SKD Complete"), value: f.num(data.complete) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("SKD TIDAK Lengkap", "SKD INCOMPLETE"), value: f.num(data.incomplete), accent: data.incomplete > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Proses", "Pending"), value: f.num(data.pending) }]} />
      </div>

      <DocSection no="B" title={t("Register Cuti Sakit & Status SKD", "Sick Leave Register & SKD Status")} note={t("Izin sakit dibayar penuh dengan Surat Keterangan Dokter — UU 13/2003 Ps.93. Baris tanpa SKD wajib ditindaklanjuti.", "Sick leave is fully paid with a medical certificate — Law 13/2003 Art.93. Rows without SKD require follow-up.")} />
      <DocTable head={<>
        <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
        <TH align="center">Mulai</TH><TH align="center">Selesai</TH><TH align="number">Hari</TH>
        <TH align="center">SKD</TH><TH>No. / Catatan SKD</TH><TH>Alasan</TH><TH align="center">Status</TH><TH>Pemutus</TH>
      </>}>
        {data.items.map((i, idx) => (
          <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", !i.skdComplete && "bg-amber-50/50")}>
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
            <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{i.name}</TD>
            <TD>{i.unit ?? <Dash />}</TD>
            <TD align="center">{f.dt(i.dateFrom)}</TD>
            <TD align="center">{f.dt(i.dateTo)}</TD>
            <TD align="number">{f.num(i.workingDays)}</TD>
            <TD align="center">
              <DocBadge tone={i.skdComplete ? "green" : "amber"}>
                {i.skdComplete ? t("Lengkap", "Complete") : t("TIDAK LENGKAP", "INCOMPLETE")}
              </DocBadge>
            </TD>
            <TD className="max-w-52 text-[9.5px] text-slate-600">{i.note ?? <span className="font-bold text-amber-600">{t("Belum dilampirkan", "Not attached")}</span>}</TD>
            <TD className="max-w-40 text-[9.5px] text-slate-600">{i.reason ?? <Dash />}</TD>
            <TD align="center"><DocBadge tone={STATUS_TONE[i.status] ?? "slate"}>{t(...(STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
            <TD className="text-[9.5px]">{i.decidedBy ?? <Dash />}</TD>
          </tr>
        ))}
        {data.items.length === 0 && (
          <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada cuti sakit pada rentang ini.", "No sick leave in this range.")}</TD></tr>
        )}
      </DocTable>

      <DocFooter meta={meta} signNote={t("SKD wajib untuk cuti sakit > 1 hari (kebijakan internal). Temuan tanpa SKD: konfirmasi ke karyawan & klinik dalam 3 hari kerja.", "SKD required for sick leave > 1 day (internal policy). Findings without SKD: confirm with employee & clinic within 3 working days.")} />
    </ReportSheet>
  );
}

// ================= LR3.3 Unexcused Absence / Alpa Log =================
export function LR33View({ data, meta }: { data: LR33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const REC_TONE: Record<string, "red" | "amber" | "violet" | "sky" | "slate"> = {
    "SP-3": "red", "SP-2": "red", "SP-1": "amber", "Teguran": "violet", "Pembinaan": "sky",
  };
  return (
    <ReportSheet docId="lr33" landscape>
      <DocHeader meta={meta} reportNo="R3.3" title="Unexcused Absence / Alpa Log" subtitle={t("Daftar Mangkir Karyawan — Dasar Surat Peringatan", "Employee No-Show Log — Warning Letter Basis")} audience={t("HR · Atasan Langsung · Legal", "HR · Line Managers · Legal")} docNo={mkDocNo("lr33", meta)} />

      <DocSection no="A" title={t("Ringkasan Disiplin", "Discipline Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Mangkir", "No-show Employees"), value: f.num(data.employees), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari Alpa", "Total Alpa Days"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Perlu SP", "Requires SP"), value: f.num(data.sp1) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tertinggi", "Top Offender"), value: data.top ? `${data.top.employeeNo} (${f.num(data.top.count)}×)` : "—" }]} />
      </div>

      <DocSection no="B" title={t("Rekap per Karyawan + Rekomendasi Tindakan", "Per-Employee Recap + Action Recommendation")} note={t("Rekomendasi mengikuti pola sanksi berjenjang — PP 36/2021; pemberhentian hanya setelah SP-3 (UU 13/2003 Ps.158).", "Recommendation follows progressive sanctions — GR 36/2021; termination only after 3rd warning (Law 13/2003 Art.158).")} />
      <DocTable head={<>
        <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="center">Status</TH>
        <TH align="number">Jumlah Alpa</TH><TH align="center">Pertama</TH><TH align="center">Terakhir</TH>
        <TH align="center">Rekomendasi</TH><TH>Tindakan</TH>
      </>}>
        {data.summary.map((r, idx) => (
          <tr key={r.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{r.name}</TD>
            <TD>{r.unit ?? <Dash />}</TD>
            <TD align="center">{r.employmentStatus}</TD>
            <TD align="number" className="font-black text-red-600">{f.num(r.count)}×</TD>
            <TD align="center">{f.dt(r.firstDate)}</TD>
            <TD align="center">{f.dt(r.lastDate)}</TD>
            <TD align="center"><DocBadge tone={REC_TONE[r.recommendation] ?? "slate"}>{r.recommendation}</DocBadge></TD>
            <TD className="text-[9.5px] text-slate-600">{r.action}</TD>
          </tr>
        ))}
        {data.summary.length === 0 && (
          <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada alpa pada rentang ini 🎉", "No no-shows in this range 🎉")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="C" title={t("Log Detail per Tanggal", "Detail Log per Date")} />
      <div className="doc-scroll max-h-[360px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">Tanggal</TH><TH align="center">Hari</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
            </tr>
          </thead>
          <tbody>
            {data.detail.map((r, idx) => (
              <tr key={`${r.date}-${r.employeeNo}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="font-bold">{f.dt(r.date)}</TD>
                <TD align="center">{r.weekday}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Sebelum menerbitkan SP, pastikan undangan klarifikasi tertulis telah dikirim (UU 13/2003 Ps.151).", "Before issuing a warning letter, ensure a written clarification summons has been sent (Law 13/2003 Art.151).")} />
    </ReportSheet>
  );
}

// ================= LR4.1 Statutory Special Leave =================
export function LR41View({ data, meta }: { data: LR41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr41" landscape>
      <DocHeader meta={meta} reportNo="R4.1" title="Statutory Special Leave Report" subtitle={t("Rekap Cuti Khusus Berbayar — UU 13/2003 & UU Cipta Kerja", "Paid Special Leave Recap — Law 13/2003 & Job Creation Law")} audience={t("HR · Legal · Disnaker · Direksi", "HR · Legal · Manpower Office · Directorate")} docNo={mkDocNo("lr41", meta)} />

      <DocSection no="A" title={t("Ringkasan per Jenis Cuti Khusus", "Summary per Special Leave Type")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Kasus", "Total Cases"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari", "Total Days"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: "Perempuan", value: f.num(data.female) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: "Laki-laki", value: f.num(data.male) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dokumen Kurang", "Docs Missing"), value: f.num(data.docsMissing), accent: data.docsMissing > 0 }]} />
      </div>

      <DocSection no="B" title={t("Matriks Jenis × Frekuensi (dasar hukum)", "Type × Frequency Matrix (legal basis)")} />
      <DocTable head={<><TH>Jenis Cuti</TH><TH>Dasar Hukum</TH><TH align="number">Kasus</TH><TH align="number">Total Hari</TH></>}>
        {data.byType.map((ty) => (
          <tr key={ty.code} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{ty.code}</TD>
            <TD className="text-[9.5px] text-slate-600">{ty.basis}</TD>
            <TD align="number">{f.num(ty.count)}</TD>
            <TD align="number">{f.num(ty.days)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[f.num(data.total), f.num(data.totalDays)]} spanLabel={2} />
      </DocTable>

      <DocSection no="C" title={t("Register Pengambilan Cuti Khusus", "Special Leave Usage Register")} />
      <div className="doc-scroll max-h-[440px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH align="center">L/P</TH><TH>Unit</TH>
              <TH>Jenis Cuti</TH><TH>Dasar Hukum</TH><TH align="center">Mulai</TH><TH align="center">Selesai</TH>
              <TH align="number">Durasi</TH><TH align="center">Status</TH><TH align="center">Dokumen</TH><TH>Alasan</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD align="center">{i.gender === "Perempuan" ? "P" : "L"}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD className="text-[9.5px] font-bold">{i.leaveType}</TD>
                <TD className="max-w-40 text-[8.5px] text-slate-500">{i.basis}</TD>
                <TD align="center">{f.dt(i.dateFrom)}</TD>
                <TD align="center">{f.dt(i.dateTo)}</TD>
                <TD align="number" className="font-bold">{f.num(i.workingDays)} {i.unitOfMeasure === "MONTH" ? t("bln", "mo") : t("hr", "d")}</TD>
                <TD align="center"><DocBadge tone={STATUS_TONE[i.status] ?? "slate"}>{t(...(STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
                <TD align="center">
                  {i.needDocs ? (
                    <DocBadge tone={i.docsComplete ? "green" : "amber"}>{i.docsComplete ? t("Lengkap", "Complete") : t("Belum", "Missing")}</DocBadge>
                  ) : <span className="text-slate-300">—</span>}
                </TD>
                <TD className="max-w-40 text-[9.5px] text-slate-600">{i.reason ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Cuti khusus di atas bersifat berbayar penuh — tidak boleh dipotong dari upah (UU 13/2003 Ps.81–93).", "Special leave above is fully paid — must not be deducted from wages (Law 13/2003 Art.81–93).")} />
    </ReportSheet>
  );
}

// ================= LR4.2 Long Leave / Grand Leave =================
export function LR42View({ data, meta }: { data: LR42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr42">
      <DocHeader meta={meta} reportNo="R4.2" title="Long Leave / Grand Leave Report" subtitle={t("Hak Istirahat Panjang (Cuti Besar) — Long-Service Rest Leave", "Long-Service Rest Leave")} audience={t("HR · Direksi", "HR · Directorate")} docNo={mkDocNo("lr42", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pernah Mengambil", "Has Taken"), value: f.num(data.takenCount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Berhak, Belum Ambil", "Eligible, Not Taken"), value: f.num(data.eligibleCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hak per Pengambilan", "Entitlement"), value: `${f.num(data.entitlement)} ${t("hari kerja", "workdays")}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Syarat Masa Kerja", "Service Requirement"), value: `${f.num(data.waitingMonths)} ${t("bulan", "months")}` }]} />
      </div>

      <DocSection no="B" title={t("Riwayat Pengambilan Cuti Besar", "Grand Leave Usage History")} />
      <DocTable head={<>
        <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
        <TH align="center">Tgl Masuk</TH><TH align="number">Masa Kerja</TH>
        <TH align="center">Mulai</TH><TH align="center">Selesai</TH><TH align="number">Hari</TH><TH align="center">Status</TH><TH>Catatan</TH>
      </>}>
        {data.taken.map((i) => (
          <tr key={i.docNo} className="hover:bg-slate-50">
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
            <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{i.name}</TD>
            <TD>{i.unit ?? <Dash />}</TD>
            <TD align="center">{f.dt(i.joinDate)}</TD>
            <TD align="number">{f.num(i.tenureYears)} thn</TD>
            <TD align="center">{f.dt(i.dateFrom)}</TD>
            <TD align="center">{f.dt(i.dateTo)}</TD>
            <TD align="number">{f.num(i.workingDays)}</TD>
            <TD align="center"><DocBadge tone={STATUS_TONE[i.status] ?? "slate"}>{t(...(STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
            <TD className="max-w-44 text-[9.5px] text-slate-600">{i.note ?? <Dash />}</TD>
          </tr>
        ))}
        {data.taken.length === 0 && (
          <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada pengambilan Cuti Besar.", "No grand leave taken yet.")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="C" title={t("Karyawan Berhak namun Belum Mengambil", "Eligible But Not Taken")} note={t("Kandidat program penghargaan masa kerja — usulkan dalam perencanaan SDM tahun berikutnya.", "Candidates for long-service program — propose in next year's workforce planning.")} />
      <div className="doc-scroll max-h-[300px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Tgl Masuk</TH><TH align="number">Masa Kerja</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.eligible.map((e, idx) => (
              <tr key={e.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{e.name}</TD>
                <TD>{e.unit ?? <Dash />}</TD>
                <TD align="center">{f.dt(e.joinDate)}</TD>
                <TD align="number" className="font-bold">{f.num(e.tenureYears)} thn</TD>
                <TD align="center">{e.employmentStatus}</TD>
              </tr>
            ))}
            {data.eligible.length === 0 && (
              <tr><TD colSpan={7} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada karyawan berhak yang belum mengambil.", "No eligible employees who haven't taken it.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Cuti Besar bersifat opsional bagi perusahaan yang memberlakukannya (kebijakan internal, bukan kewajiban undang-undang).", "Grand leave is optional for companies that adopt it (internal policy, not a statutory obligation).")} />
    </ReportSheet>
  );
}

// ================= LR4.3 Menstrual Leave Audit =================
export function LR43View({ data, meta }: { data: LR43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="lr43">
      <DocHeader meta={meta} reportNo="R4.3" title="Menstrual Leave Audit Sheet" subtitle={t("Rekap Cuti Haid Karyawan Perempuan — UU 13/2003 Ps.81", "Female Employee Menstrual Leave — Law 13/2003 Art.81")} audience={t("HR · Kepatuhan · Auditor", "HR · Compliance · Auditor")} docNo={mkDocNo("lr43", meta)} />

      <DocSection no="A" title={t("Ringkasan Audit", "Audit Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Pengajuan", "Total Requests"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hari", "Total Days"), value: f.num(data.totalDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Unik", "Unique Employees"), value: `${f.num(data.uniqueEmployees)} / ${f.num(data.femaleActive)}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata / Karyawan", "Avg / Employee"), value: `${f.num(data.avgPerEmployee)} hari` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Disetujui / Menunggu", "Approved / Pending"), value: `${f.num(data.approved)} / ${f.num(data.pending)}` }]} />
      </div>

      <DocSection no="B" title={t("Register Cuti Haid", "Menstrual Leave Register")} note={t("Hak 2 hari per bulan — TIDAK dihitung sebagai ketidakhadiran dalam perhitungan upah (UU 13/2003 Ps.81).", "Entitlement 2 days per month — NOT counted as absence in wage calculation (Law 13/2003 Art.81).")} />
      <DocTable head={<>
        <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
        <TH align="center">Tanggal</TH><TH align="center">Sesi</TH><TH align="number">Hari</TH>
        <TH align="center">Status</TH><TH>Alasan</TH><TH>Pemutus</TH>
      </>}>
        {data.items.map((i, idx) => (
          <tr key={i.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
            <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{i.name}</TD>
            <TD>{i.unit ?? <Dash />}</TD>
            <TD align="center">{f.dt(i.dateFrom)}</TD>
            <TD align="center">{i.sessionFrom === "PM" ? t("Sore", "PM") : t("Pagi–Sore", "AM–PM")}</TD>
            <TD align="number">{f.num(i.workingDays)}</TD>
            <TD align="center"><DocBadge tone={STATUS_TONE[i.status] ?? "slate"}>{t(...(STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
            <TD className="max-w-44 text-[9.5px] text-slate-600">{i.reason ?? <Dash />}</TD>
            <TD className="text-[9.5px]">{i.decidedBy ?? <Dash />}</TD>
          </tr>
        ))}
        {data.items.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada cuti haid pada rentang ini.", "No menstrual leave in this range.")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="C" title={t("Penggunaan Tertinggi", "Highest Usage")} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {data.top.map((x) => (
          <SummaryBox key={x.employeeNo} className="grid-cols-1" items={[{ label: x.employeeNo, value: `${f.num(x.days)} hari` }]} />
        ))}
      </div>

      <DocFooter meta={meta} signNote={t("Cuti haid wajib dilaporkan saat terjadi — tidak dapat diakumulasi atau digantikan uang (praktik Disnaker).", "Menstrual leave must be reported when it occurs — cannot be accumulated or cashed out (Manpower Office practice).")} />
    </ReportSheet>
  );
}
