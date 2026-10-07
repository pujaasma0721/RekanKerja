"use client";
// T113 — views dokumen Attendance Grup 1 (Rekap Berkala) + Grup 2 ============
// (Keterlambatan & Jam Kerja Kurang). Komponen dasar (ReportSheet/DocHeader/
// DocFooter/…) dipakai bersama dari doc-kit modul HR — murni presentasional.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type { DocMeta, AR11Data, AR12Data, AR13Data, AR21Data, AR22Data, AR23Data } from "./types";

/** No. dokumen deterministik: AT/AR11/2026/10. */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `AT/${id.slice(1).toUpperCase()}/${meta.year}/${mm}`;
}

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Present: "green", Late: "amber", Absent: "red", Off: "slate", Holiday: "slate", WorkOff: "sky", OnLeave: "violet",
};
const STATUS_LABEL: Record<string, [string, string]> = {
  Present: ["Hadir", "Present"], Late: ["Telat", "Late"], Absent: ["Absen", "Absent"],
  Off: ["Off", "Off"], Holiday: ["Libur", "Holiday"], WorkOff: ["Izin", "Permit"], OnLeave: ["Cuti", "On Leave"],
};
const SEV_TONE: Record<string, "red" | "amber" | "slate"> = { tinggi: "red", sedang: "amber", ringan: "slate" };
const SEV_LABEL: Record<string, [string, string]> = {
  tinggi: ["Tinggi", "High"], sedang: ["Sedang", "Medium"], ringan: ["Ringan", "Low"],
};

// ================= AR1.1 Monthly Attendance Summary Roll =================
export function AR11View({ data, meta }: { data: AR11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar11" landscape>
      <DocHeader meta={meta} reportNo="R1.1" title="Monthly Attendance Summary Roll" subtitle={t(`Rekap Kehadiran Bulanan — Dasar Input Payroll · ${data.month}`, `Payroll Input Basis · ${data.month}`)} audience={t("Payroll · HR · Kepala Departemen", "Payroll · HR · Department Heads")} docNo={mkDocNo("ar11", meta)} />

      <DocSection no="A" title={t("Ringkasan Bulan", "Month Summary")} note={t("Hadir termasuk hari telat; Off/Libur di luar hari terjadwal. Sakit dipisah dari cuti lainnya (SKD — UU 13/2003 Ps.93).", "Present includes late days; Off/Holiday excluded from scheduled days. Sick is split from other leave (SKD — Law 13/2003 Art.93).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employees"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hari Kerja", "Workdays"), value: f.num(data.workdays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Hadir", "Total Present"), value: f.num(data.sum.present) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Telat (hari)", "Late (days)"), value: f.num(data.sum.lateDays) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Alpa", "No-show"), value: f.num(data.sum.absent), accent: data.sum.absent > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sakit + Cuti + Izin", "Sick + Leave + Permit"), value: f.num(data.sum.sick + data.sum.leaveOther + data.sum.workoff) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jam Kerja / Lembur", "Work / OT Hours"), value: `${f.num(data.sum.workHours)} / ${f.num(data.sum.overtimeHours)}`, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Rekap per Karyawan (urut Unit & No.)", "Register per Employee (by Unit & No.)")} note={t("Tingkat Hadir = hadir ÷ (hadir + alpa). Kolom ini menjadi dasar komponen tunjangan kehadiran & potongan TABS.", "Attendance Rate = present ÷ (present + no-show). This register drives the attendance allowance & absence deduction components.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama Lengkap</TH><TH>Unit / Departemen</TH>
              <TH align="center">Status</TH><TH align="number">Terjadwal</TH>
              <TH align="number">Hadir</TH><TH align="number">Telat (hari)</TH><TH align="number">Telat (menit)</TH>
              <TH align="number">Sakit</TH><TH align="number">Cuti Lain</TH><TH align="number">Izin</TH><TH align="number">Alpa</TH><TH align="number">Off/Libur</TH>
              <TH align="number">Jam Kerja</TH><TH align="number">Jam Lembur</TH><TH align="number">Hadir %</TH>
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
                <TD align="number">{f.num(r.scheduled)}</TD>
                <TD align="number" className="font-bold">{f.num(r.present)}</TD>
                <TD align="number">{r.lateDays ? <span className="font-bold text-amber-700">{f.num(r.lateDays)}</span> : <Dash />}</TD>
                <TD align="number">{r.lateMinutes || <Dash />}</TD>
                <TD align="number">{r.sick || <Dash />}</TD>
                <TD align="number">{r.leaveOther || <Dash />}</TD>
                <TD align="number">{r.workoff || <Dash />}</TD>
                <TD align="number" className={cn("font-bold", r.absent > 0 && "text-red-600")}>{r.absent || <Dash />}</TD>
                <TD align="number">{r.off || <Dash />}</TD>
                <TD align="number">{f.num(r.workHours)}</TD>
                <TD align="number">{r.overtimeHours || <Dash />}</TD>
                <TD align="number" className="font-black">{r.attendanceRate != null ? f.pct(r.attendanceRate) : <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <DocTable head={<>
          <TH>TOTAL — {data.total} KARYAWAN</TH>
          <TH align="number">Terjadwal</TH><TH align="number">Hadir</TH><TH align="number">Telat (hari)</TH><TH align="number">Telat (menit)</TH>
          <TH align="number">Sakit</TH><TH align="number">Cuti Lain</TH><TH align="number">Izin</TH><TH align="number">Alpa</TH>
          <TH align="number">Off/Libur</TH><TH align="number">Jam Kerja</TH><TH align="number">Jam Lembur</TH><TH align="number">Hadir %</TH>
        </>}>
          <TotalRow label={`TOTAL — ${data.total} ${t("karyawan", "employees")}`} cells={[
            f.num(data.sum.scheduled), f.num(data.sum.present), f.num(data.sum.lateDays), f.num(data.sum.lateMinutes),
            f.num(data.sum.sick), f.num(data.sum.leaveOther), f.num(data.sum.workoff), f.num(data.sum.absent),
            f.num(data.sum.off), f.num(data.sum.workHours), f.num(data.sum.overtimeHours), "—",
          ]} spanLabel={1} />
        </DocTable>
      </div>

      <DocFooter meta={meta} signNote={t("Dokumen ini menjadi lampiran input payroll bulanan — rekonsiliasi final dengan hasil payroll run sebelum dibayar.", "This document is the monthly payroll input attachment — final reconciliation with the payroll run before payment.")} />
    </ReportSheet>
  );
}

// ================= AR1.2 Daily Attendance Timesheet =================
export function AR12View({ data, meta }: { data: AR12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar12" landscape>
      <DocHeader meta={meta} reportNo="R1.2" title="Daily Attendance Timesheet" subtitle={t(`Detail Jam Masuk, Jam Pulang & Lokasi — ${data.dateLabel}`, `Check-in, Check-out & Location Detail — ${data.dateLabel}`)} audience={t("HR · Supervisor · Operations", "HR · Supervisors · Operations")} docNo={mkDocNo("ar12", meta)} />

      <DocSection no="A" title={t("Ringkasan Hari", "Day Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris Rekap", "Recap Rows"), value: f.num(data.rows.length), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hadir", "Present"), value: f.num(data.counts.present) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Telat", "Late"), value: f.num(data.counts.late) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Absen", "Absent"), value: f.num(data.counts.absent) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Cuti + Izin", "Leave + Permit"), value: f.num(data.counts.onLeave + data.counts.workoff) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Off / Libur", "Off / Holiday"), value: f.num(data.counts.off) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tepat Waktu", "On-time"), value: data.onTimePct != null ? f.pct(data.onTimePct) : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Timesheet per Karyawan", "Timesheet per Employee")} note={t("Lokasi check-in dari koordinat GPS log presensi (terdekat dengan lokasi kerja resmi). Status Tanpa clock-out = koreksi diperlukan.", "Check-in location from GPS coordinates of the presence log (nearest official work location).")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama Lengkap</TH><TH>Unit</TH>
              <TH align="center">Day Type</TH><TH align="center">Jadwal Shift</TH>
              <TH align="center">Jam Masuk</TH><TH align="center">Jam Pulang</TH>
              <TH align="number">Telat (m)</TH><TH align="number">Pulang Cepat (m)</TH>
              <TH align="number">Jam Kerja</TH><TH>Lokasi Check-in</TH><TH align="center">Status</TH><TH>Catatan</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.status === "Absent" && "bg-red-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{r.dayTypeCode ?? <Dash />}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{r.shift ?? "—"}</TD>
                <TD align="center" className={cn("font-mono", r.lateMinutes > 0 && "font-bold text-amber-700")}>{r.checkIn ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{r.checkOut ?? <Dash />}</TD>
                <TD align="number">{r.lateMinutes || <Dash />}</TD>
                <TD align="number">{r.earlyMinutes || <Dash />}</TD>
                <TD align="number">{r.workHours != null ? f.num(r.workHours) : <Dash />}</TD>
                <TD className="max-w-56 text-[9.5px] text-slate-600">{r.location ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={STATUS_TONE[r.status] ?? "slate"}>{t(...(STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD className="max-w-44 text-[9.5px] text-slate-500">{r.notes ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Timesheet harian — jam mengikuti data clock log terverifikasi; koreksi melalui form revisi timesheet dengan persetujuan supervisor.", "Daily timesheet — times follow verified clock logs; corrections via the timesheet revision form with supervisor approval.")} />
    </ReportSheet>
  );
}

// ================= AR1.3 Multi-Location / Geofencing =================
export function AR13View({ data, meta }: { data: AR13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar13" landscape>
      <DocHeader meta={meta} reportNo="R1.3" title="Multi-Location / Geofencing Attendance Sheet" subtitle={t("Presensi berdasarkan Lokasi Absen — WFO · WFH · Kunjungan Klien (GPS)", "Presence by Absence Location — WFO · WFH · Client Visits (GPS)")} audience={t("HR · Operations · Sales Manager", "HR · Operations · Sales Manager")} docNo={mkDocNo("ar13", meta)} />

      <DocSection no="A" title={t("Ringkasan Radius", "Radius Summary")} note={t("Jarak dihitung ke lokasi kerja resmi terdekat; punch di luar radius ditandai untuk verifikasi.", "Distance computed to the nearest official work location; out-of-radius punches are flagged for verification.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Punch", "Total Punches"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Di Dalam Radius", "Within Radius"), value: f.num(data.within) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Di Luar Radius", "Outside Radius"), value: f.num(data.outside), accent: data.outside > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employees"), value: f.num(data.employees) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Lokasi Resmi", "Official Locations"), value: f.num(data.locationsCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepatuhan Radius", "Radius Compliance"), value: data.total ? f.pct(Math.round((data.within / data.total) * 1000) / 10) : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Sebaran per Lokasi", "Distribution by Location")} />
      <DocTable head={<><TH>Lokasi</TH><TH align="number">Jumlah Punch</TH><TH align="number">Karyawan Unik</TH></>}>
        {data.byLocation.map((l) => (
          <tr key={l.name} className="hover:bg-slate-50">
            <TD className={cn("font-bold", l.name === "Di luar radius" && "text-amber-700")}>{l.name}</TD>
            <TD align="number">{f.num(l.punches)}</TD>
            <TD align="number">{f.num(l.employees)}</TD>
          </tr>
        ))}
      </DocTable>

      <DocSection no="C" title={t("Log Punch Berkoordinat", "Geo-tagged Punch Log")} />
      <div className="doc-scroll max-h-[440px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Jam</TH><TH align="center">Arah</TH><TH align="center">Sumber</TH>
              <TH>Koordinat</TH><TH>Lokasi Terdekat</TH>
              <TH align="number">Jarak</TH><TH align="number">Radius</TH><TH align="center">Status Radius</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.employeeNo}-${i.date}-${i.time}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", !i.within && "bg-amber-50/40")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{i.time}</TD>
                <TD align="center">{i.direction === "IN" ? t("Masuk", "IN") : t("Pulang", "OUT")}</TD>
                <TD align="center">{i.source}</TD>
                <TD className="font-mono text-[9px] text-slate-500">{i.lat}, {i.lng}</TD>
                <TD className="text-[9.5px]">{i.nearestName ?? <Dash />}</TD>
                <TD align="number">{i.distanceM != null ? `${f.num(i.distanceM)} m` : <Dash />}</TD>
                <TD align="number">{i.radiusM != null ? f.num(i.radiusM) : <Dash />}</TD>
                <TD align="center">
                  <DocBadge tone={i.within ? "green" : "amber"}>
                    {i.within ? t("Di Radius", "Within") : t("DI LUAR", "OUTSIDE")}
                  </DocBadge>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Punch di luar radius bukan otomatis pelanggaran (WFH/kunjungan klien sah) — verifikasi dengan form perjalanan dinas/kebijakan WFH.", "Out-of-radius punches are not automatically violations (legitimate WFH/client visits) — verify against travel forms/WFH policy.")} />
    </ReportSheet>
  );
}

// ================= AR2.1 Late Arrival & Early Leaver Log =================
export function AR21View({ data, meta }: { data: AR21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar21" landscape>
      <DocHeader meta={meta} reportNo="R2.1" title="Late Arrival & Early Leaver Log" subtitle={t("Daftar Masuk Telat & Pulang Cepat — Menit Pelanggaran vs Jadwal", "Late-in & Early-out Register — Violation Minutes vs Schedule")} audience={t("HR · Atasan Langsung · Supervisor", "HR · Line Managers · Supervisors")} docNo={mkDocNo("ar21", meta)} />

      <DocSection no="A" title={t("Ringkasan Pelanggaran", "Violation Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kejadian Telat", "Late Events"), value: f.num(data.lateCount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Menit Telat", "Total Late Minutes"), value: f.num(data.lateMinutes) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Telat", "Average Late"), value: `${f.num(data.avgLate)} m` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pulang Cepat", "Early Leaver"), value: f.num(data.earlyCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Menit Cepat", "Total Early Minutes"), value: f.num(data.earlyMinutes) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pelanggar Terbanyak", "Worst Offender"), value: data.worst ? `${data.worst.name} (${f.num(data.worst.lateCount)}×)` : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Log Detail (urut tanggal terbaru)", "Detail Log (latest first)")} note={t("Severity: Tinggi > 30 menit · Sedang 16–30 · Ringan ≤ 15. Menit dihitung di luar toleransi shift.", "Severity: High > 30 minutes · Medium 16–30 · Low ≤ 15. Minutes counted beyond shift tolerance.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Shift</TH>
              <TH align="center">Jadwal Masuk</TH><TH align="center">Aktual Masuk</TH><TH align="number">Telat (menit)</TH>
              <TH align="center">Jadwal Pulang</TH><TH align="center">Aktual Pulang</TH><TH align="number">Cepat (menit)</TH>
              <TH align="center">Severity</TH><TH>Catatan</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.employeeNo}-${i.date}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.severity === "tinggi" && "bg-red-50/40")}>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.dayTypeCode ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{i.plannedIn ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{i.actualIn ?? <Dash />}</TD>
                <TD align="number" className={cn("font-bold", i.lateMinutes > 30 && "text-red-600")}>{i.lateMinutes || <Dash />}</TD>
                <TD align="center" className="font-mono">{i.plannedOut ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{i.actualOut ?? <Dash />}</TD>
                <TD align="number">{i.earlyMinutes || <Dash />}</TD>
                <TD align="center"><DocBadge tone={SEV_TONE[i.severity]}>{t(...SEV_LABEL[i.severity])}</DocBadge></TD>
                <TD className="max-w-40 text-[9.5px] text-slate-500">{i.note ?? <Dash />}</TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={13} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada keterlambatan / pulang cepat pada rentang ini.", "No late arrival / early leaving in this range.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Menit keterlambatan & pulang cepat menjadi dasar potongan proporsional (1/173 × upah/jam) pada komponen TLATE — lihat R3.2 utk sisi lembur.", "Late & early minutes drive the proportional TLATE deduction (1/173 × hourly wage) — see R3.2 for the overtime side.")} />
    </ReportSheet>
  );
}

// ================= AR2.2 Working Hours Deficit Report =================
export function AR22View({ data, meta }: { data: AR22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const ST_TONE: Record<string, "green" | "amber" | "red"> = { ok: "green", watch: "amber", deficit: "red" };
  const ST_LABEL: Record<string, [string, string]> = { ok: ["Sesuai", "On Target"], watch: ["Perhatian", "Watch"], deficit: ["DEFISIT", "DEFICIT"] };
  return (
    <ReportSheet docId="ar22" landscape>
      <DocHeader meta={meta} reportNo="R2.2" title="Working Hours Deficit Report" subtitle={t("Jam Kerja Efektif Kurang dari Standar Perusahaan (40 jam/minggu)", "Effective Hours Below Company Standard (40 hrs/week)")} audience={t("HR · Manajer Departemen · Payroll", "HR · Department Managers · Payroll")} docNo={mkDocNo("ar22", meta)} />

      <DocSection no="A" title={t("Ringkasan Perusahaan", "Company Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Terjadwal", "Scheduled Employees"), value: f.num(data.rows.length), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Target (jam)", "Target (hrs)"), value: f.num(data.totalTarget) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Aktual (jam)", "Actual (hrs)"), value: f.num(data.totalActual) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Defisit (jam)", "Total Deficit (hrs)"), value: f.num(data.totalDeficit) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Defisit", "Deficit Employees"), value: f.num(data.deficitEmployees), accent: data.deficitEmployees > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pencapaian", "Achievement"), value: data.achievement != null ? f.pct(data.achievement) : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Rincian per Karyawan (urut defisit terbesar)", "Detail per Employee (largest deficit first)")} note={t("Target = jam normal jadwal hari kerja; Status: Sesuai ≥ 97,5% · Perhatian 90–97,5% · DEFISIT < 90%.", "Target = scheduled normal hours on workdays; Status: On Target ≥ 97.5% · Watch 90–97.5% · DEFICIT < 90%.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="number">Hari Kerja</TH>
              <TH align="number">Target (jam)</TH><TH align="number">Aktual (jam)</TH><TH align="number">Defisit (jam)</TH>
              <TH align="number">Rata-rata / Hari</TH><TH align="number">Pencapaian %</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.status === "deficit" && "bg-red-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="number">{f.num(r.workdays)}</TD>
                <TD align="number">{f.num(r.targetHours)}</TD>
                <TD align="number">{f.num(r.actualHours)}</TD>
                <TD align="number" className={cn("font-bold", r.deficitHours > 0 && "text-red-600")}>{r.deficitHours || <Dash />}</TD>
                <TD align="number">{f.num(r.avgPerDay)}</TD>
                <TD align="number" className="font-black">{r.achievement != null ? f.pct(r.achievement) : <Dash />}</TD>
                <TD align="center"><DocBadge tone={ST_TONE[r.status]}>{t(...ST_LABEL[r.status])}</DocBadge></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Defisit jam kerja menurut UU 13/2003 Ps.93 dapat dipotong proporsional upah (waktu tak bekerja tidak dibayar) — konfirmasi alasan defisit (izin tanpa saldo vs mangkir) sebelum pemotongan.", "Working-hour deficits may be proportionally deducted per Law 13/2003 Art.93 — confirm the reason (unpaid leave vs no-show) before deducting.")} />
    </ReportSheet>
  );
}

// ================= AR2.3 Top Attendance Offenders Sheet =================
export function AR23View({ data, meta }: { data: AR23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar23" landscape>
      <DocHeader meta={meta} reportNo="R2.3" title="Top Attendance Offenders Sheet" subtitle={t("Peringkat Pelanggar Presensi — Tindak Lanjut Konseling / SP", "Attendance Offender Ranking — Counseling / Warning Follow-up")} audience={t("HR · Atasan Langsung · Legal", "HR · Line Managers · Legal")} docNo={mkDocNo("ar23", meta)} />

      <DocSection no="A" title={t("Ringkasan Klasifikasi", "Classification Summary")} note={t("Poin = (jumlah telat × 1) + (jumlah alpa × 3) — alpa berbobot lebih berat. Top 20 ditampilkan.", "Points = (late count × 1) + (no-show count × 3) — no-shows weigh heavier. Top 20 shown.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Ditandai", "Flagged Employees"), value: f.num(data.flagged), accent: true }]} />
        {data.byRec.map((r) => (
          <SummaryBox key={r.recommendation} className="grid-cols-1" items={[{ label: r.recommendation, value: f.num(r.count) }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Telat + Alpa", "Total Late + No-show"), value: f.num(data.totalLate + data.totalAbsent) }]} />
      </div>

      <DocSection no="B" title={t("Peringkat Pelanggar (Top 20)", "Offender Ranking (Top 20)")} note={t("Rekomendasi SP berjenjang mengacu UU 13/2003 Ps.158 & PP 36/2021 (SP maks 6 bulan masa berlaku).", "Progressive warning recommendation per Law 13/2003 Art.158 & GR 36/2021 (max 6-month validity per warning).")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="number">Telat (hari)</TH><TH align="number">Telat (menit)</TH><TH align="number">Alpa (hari)</TH>
              <TH align="number">Izin</TH><TH align="number">Cuti</TH><TH align="number">Total</TH><TH align="number">Poin</TH>
              <TH>Rekomendasi</TH><TH>Tindakan</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", r.rank % 2 === 0 && "bg-slate-50/60", r.points >= 12 && "bg-red-50/40")}>
                <TD align="center" className="font-black text-slate-500">{r.rank}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="number">{f.num(r.lateCount)}</TD>
                <TD align="number">{f.num(r.lateMinutes)}</TD>
                <TD align="number" className={cn("font-bold", r.absentDays > 0 && "text-red-600")}>{f.num(r.absentDays)}</TD>
                <TD align="number">{f.num(r.workoffDays)}</TD>
                <TD align="number">{f.num(r.leaveDays)}</TD>
                <TD align="number" className="font-bold">{f.num(r.violations)}</TD>
                <TD align="number" className="font-black">{f.num(r.points)}</TD>
                <TD className="text-[9.5px] font-bold text-slate-700">{r.recommendation}</TD>
                <TD className="max-w-64 text-[9px] leading-snug text-slate-500">{r.action}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={13} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada pelanggar presensi pada rentang ini.", "No attendance offenders in this range.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Sebelum menerbitkan SP, pastikan alpa bukan cuti/izin yang pengajuannya tertunda — cross-check dengan Laporan Cuti modul Leave.", "Before issuing warnings, verify no-shows are not delayed leave requests — cross-check with the Leave module reports.")} />
    </ReportSheet>
  );
}
