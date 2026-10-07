"use client";
// T113 — views dokumen Attendance Grup 3 (Lembur) + Grup 4 (Jadwal & Shift) ==
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import { mkDocNo } from "./report-views-g12";
import type { DocMeta, AR31Data, AR32Data, AR33Data, AR41Data, AR42Data, AR43Data } from "./types";

const OT_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky"> = {
  Pending: "amber", Approved: "green", Paid: "sky", Rejected: "red", Cancelled: "slate",
};
const OT_STATUS_LABEL: Record<string, [string, string]> = {
  Pending: ["Menunggu", "Pending"], Approved: ["Disetujui", "Approved"], Paid: ["Dibayar", "Paid"],
  Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
};
const DAYCAT_LABEL: Record<string, [string, string]> = {
  Weekday: ["Hari Kerja", "Weekday"], Weekend: ["Akhir Pekan", "Weekend"], Holiday: ["Hari Libur", "Holiday"],
};
const SEV_TONE: Record<string, "red" | "amber" | "slate"> = { tinggi: "red", sedang: "amber", ringan: "slate" };
const SEV_LABEL: Record<string, [string, string]> = {
  tinggi: ["Tinggi", "High"], sedang: ["Sedang", "Medium"], ringan: ["Ringan", "Low"],
};

// ================= AR3.1 Overtime Summary Report =================
export function AR31View({ data, meta }: { data: AR31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar31" landscape>
      <DocHeader meta={meta} reportNo="R3.1" title="Overtime Summary Report" subtitle={t("Rekapitulasi Jam Lembur — Hari Kerja vs Akhir Pekan / Hari Libur (Disetujui Atasan)", "Overtime Recap — Weekday vs Weekend / Holiday (Manager-approved)")} audience={t("HR · Payroll · Kepala Departemen", "HR · Payroll · Department Heads")} docNo={mkDocNo("ar31", meta)} />

      <DocSection no="A" title={t("Ringkasan Lembur", "Overtime Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Order", "Total Orders"), value: f.num(data.totalOrders), accent: true }]} />
        {data.byCategory.map((c) => (
          <SummaryBox key={c.dayCategory} className="grid-cols-1" items={[{ label: `${c.label} (${f.num(c.count)})`, value: `${f.num(c.verifiedHours)} ${t("jam", "hrs")}` }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jam Terverifikasi", "Verified Hours"), value: `${f.num(data.totalVerifiedHours)} ${t("jam", "hrs")}`, accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Lembur", "Overtime Employees"), value: f.num(data.employees) }]} />
      </div>

      <DocSection no="B" title={t("Sebaran Status", "Status Distribution")} />
      <DocTable head={<><TH>Status</TH><TH align="number">Jumlah Order</TH></>}>
        {data.byStatus.map((s) => (
          <tr key={s.status} className="hover:bg-slate-50">
            <TD><DocBadge tone={OT_STATUS_TONE[s.status] ?? "slate"}>{t(...(OT_STATUS_LABEL[s.status] ?? [s.label, s.label]))}</DocBadge></TD>
            <TD align="number">{f.num(s.count)}</TD>
          </tr>
        ))}
      </DocTable>

      <DocSection no="C" title={t("Register Perintah Lembur", "Overtime Order Register")} note={t("Jam terverifikasi = jam dibayar (hasil perbandingan clocking vs rencana). Indeks multiplier mengikuti kategori hari.", "Verified hours = paid hours (clocking vs plan comparison). Multiplier index follows the day category.")} />
      <div className="doc-scroll max-h-[440px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Order</TH><TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Kategori Hari</TH><TH align="center">Jam</TH>
              <TH align="number">Rencana (jam)</TH><TH align="number">Aktual (jam)</TH><TH align="number">Terverifikasi (jam)</TH>
              <TH align="center">Indeks</TH><TH align="center">Status</TH><TH>Pemutus</TH><TH>Alasan</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.orderNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.dayCategory === "Holiday" && "bg-violet-50/40")}>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.orderNo}</TD>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={i.dayCategory === "Weekday" ? "slate" : i.dayCategory === "Weekend" ? "amber" : "violet"}>{t(...DAYCAT_LABEL[i.dayCategory] ?? [i.dayCategory, i.dayCategory])}</DocBadge></TD>
                <TD align="center" className="font-mono">{i.window}</TD>
                <TD align="number">{f.num(i.planHours)}</TD>
                <TD align="number">{f.num(i.actualHours)}</TD>
                <TD align="number" className="font-black">{f.num(i.verifiedHours)}</TD>
                <TD align="center">{i.rateMultiplier}×</TD>
                <TD align="center"><DocBadge tone={OT_STATUS_TONE[i.status] ?? "slate"}>{t(...(OT_STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
                <TD className="text-[9.5px]">{i.approver ?? <Dash />}</TD>
                <TD className="max-w-48 text-[9px] leading-snug text-slate-500">{i.reason ?? <Dash />}</TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={14} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada perintah lembur pada rentang/filter ini.", "No overtime orders in this range/filter.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <DocTable head={<>
          <TH>TOTAL — {data.totalOrders} ORDER</TH>
          {data.byCategory.map((c) => <TH key={c.dayCategory} align="number">{c.label}</TH>)}
          <TH align="number">Jam Terverifikasi</TH><TH align="number">Karyawan</TH>
        </>}>
          <TotalRow label={`TOTAL — ${data.totalOrders} ${t("order", "orders")}`} cells={[
            ...data.byCategory.map((c) => `${f.num(c.verifiedHours)} ${t("jam", "hrs")}`),
            `${f.num(data.totalVerifiedHours)} ${t("jam", "hrs")}`,
            f.num(data.employees),
          ]} spanLabel={1} />
        </DocTable>
      </div>

      <DocFooter meta={meta} signNote={t("Hanya order disetujui yang dibayar; jam terverifikasi menjadi dasar transfer komponen LEMBUR ke payroll (lihat R3.2 utk estimasi rupiah).", "Only approved orders are paid; verified hours drive the LEMBUR payroll component transfer (see R3.2 for the rupiah estimate).")} />
    </ReportSheet>
  );
}

// ================= AR3.2 Overtime Financial Estimate Sheet =================
export function AR32View({ data, meta }: { data: AR32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const rp = (n: number | null) => (n == null ? <span className="text-slate-300">{"•••"}</span> : `Rp ${n.toLocaleString("id-ID")}`);
  return (
    <ReportSheet docId="ar32" landscape>
      <DocHeader meta={meta} reportNo="R3.2" title="Overtime Financial Estimate Sheet" subtitle={t("Estimasi Indeks Lembur UU Cipta Kerja / PP 35/2021 — untuk Finance & Payroll", "Job Creation Law / GR 35/2021 Overtime Index Estimate — for Finance & Payroll")} audience={t("Finance/Payroll · Direksi · Auditor", "Finance/Payroll · Directorate · Auditor")} docNo={mkDocNo("ar32", meta)} />

      <DocSection no="A" title={t("Ringkasan Estimasi", "Estimate Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Order Diverifikasi", "Verified Orders"), value: f.num(data.orders), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Jam", "Total Hours"), value: `${f.num(data.totalHours)} ${t("jam", "hrs")}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Estimasi (Rp)", "Total Estimate (Rp)"), value: data.totalPay != null ? `Rp ${data.totalPay.toLocaleString("id-ID")}` : "•••", accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Basis Indeks", "Index Basis"), value: t("Gaji ÷ 173", "Salary ÷ 173") }]} />
      </div>

      {data.masked && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
          {t("⚠ Brankas uang terkunci — nilai rupiah disembunyikan (•••). Buka Brankas Uang untuk menampilkan estimasi biaya.", "⚠ Money vault locked — rupiah values hidden (•••). Open the Money Vault to reveal the cost estimate.")}
        </p>
      )}

      <DocSection no="B" title={t("Rincian Estimasi per Order", "Estimate Detail per Order")} note={data.basisNote} />
      <div className="doc-scroll max-h-[480px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Order</TH><TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Kategori Hari</TH><TH align="number">Jam Verif.</TH>
              <TH align="number">Gaji Pokok (Rp/bln)</TH><TH align="number">Upah/Jam (Rp)</TH>
              <TH align="number">Estimasi Bayar (Rp)</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={i.orderNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.orderNo}</TD>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={i.dayCategory === "Weekday" ? "slate" : i.dayCategory === "Weekend" ? "amber" : "violet"}>{t(...DAYCAT_LABEL[i.dayCategory] ?? [i.dayCategory, i.dayCategory])}</DocBadge></TD>
                <TD align="number" className="font-bold">{f.num(i.verifiedHours)}</TD>
                <TD align="number">{rp(i.monthlySalary)}</TD>
                <TD align="number">{rp(i.hourlyRate)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.estimatedPay)}</TD>
                <TD align="center"><DocBadge tone={OT_STATUS_TONE[i.status] ?? "slate"}>{t(...(OT_STATUS_LABEL[i.status] ?? [i.status, i.status]))}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada order lembur terverifikasi pada rentang/filter ini.", "No verified overtime orders in this range/filter.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Indeks Berlaku (PP 35/2021 Ps.31)", "Applicable Index (GR 35/2021 Art.31)")} />
      <DocTable head={<><TH>Kategori Hari</TH><TH>Jam ke-1</TH><TH>Jam Berikutnya</TH></>}>
        <tr className="hover:bg-slate-50">
          <TD className="font-bold">{t("Hari Kerja (Weekday)", "Weekday")}</TD>
          <TD align="center">1,5×</TD><TD align="center">2×</TD>
        </tr>
        <tr className="hover:bg-slate-50">
          <TD className="font-bold">{t("Akhir Pekan (Weekend)", "Weekend")}</TD>
          <TD align="center">2× ({t("8 jam pertama", "first 8 hrs")})</TD><TD align="center">3×</TD>
        </tr>
        <tr className="hover:bg-slate-50">
          <TD className="font-bold">{t("Hari Libur (Holiday)", "Holiday")}</TD>
          <TD align="center">2× ({t("7 jam pertama", "first 7 hrs")})</TD><TD align="center">3× ({t("jam ke-8", "8th hr")}) · 4×</TD>
        </tr>
      </DocTable>

      <DocFooter meta={meta} signNote={t("Estimasi = 1/173 × upah/jam × indeks progresif, dibulatkan ke interval pembulatan lembur (lihat Pengaturan Presensi). Nilai final mengikuti payroll run — bukan komitmen pembayaran.", "Estimate = 1/173 × hourly wage × progressive index, rounded to the overtime rounding interval (see Attendance Settings). Final value follows the payroll run — not a payment commitment.")} />
    </ReportSheet>
  );
}

// ================= AR3.3 Working Hours Compliance Audit =================
export function AR33View({ data, meta }: { data: AR33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const ST_TONE: Record<string, "green" | "amber" | "red"> = { compliant: "green", watch: "amber", violation: "red" };
  const ST_LABEL: Record<string, [string, string]> = { compliant: ["Patuh", "Compliant"], watch: ["Perhatian", "Watch"], violation: ["PELANGGARAN", "VIOLATION"] };
  return (
    <ReportSheet docId="ar33" landscape>
      <DocHeader meta={meta} reportNo="R3.3" title="Working Hours Compliance Audit" subtitle={t(`Pemantauan Cap Lembur — ${data.month} · Mode ${data.modeLabel}`, `Overtime Cap Monitoring — ${data.month} · ${data.modeLabel} mode`)} audience={t("HR · Legal/Kepatuhan · Auditor", "HR · Legal/Compliance · Auditor")} docNo={mkDocNo("ar33", meta)} />

      <DocSection no="A" title={t("Ringkasan Kepatuhan", "Compliance Summary")} note={`${data.basis} — cap ${data.caps.dailyHours} ${t("jam/hari", "hrs/day")} · ${data.caps.weeklyHours} ${t("jam/minggu", "hrs/week")}${data.caps.monthlyHours ? ` · ${data.caps.monthlyHours} ${t("jam/bulan", "hrs/month")}` : ""}.`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Lembur", "Overtime Employees"), value: f.num(data.withOt), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Patuh", "Compliant"), value: f.num(data.compliant) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Perhatian (≥80% cap)", "Watch (≥80% cap)"), value: f.num(data.watch) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pelanggaran", "Violations"), value: f.num(data.violation), accent: data.violation > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tingkat Kepatuhan", "Compliance Rate"), value: data.complianceRate != null ? f.pct(data.complianceRate) : <Dash />, accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Mode Cap", "Cap Mode"), value: data.modeLabel }]} />
      </div>

      <DocSection no="B" title={t("Audit per Karyawan (pelanggaran di atas)", "Audit per Employee (violations first)")} note={t("Menit efektif = order Pending (rencana) + Approved/Paid (terverifikasi). Temuan wajib ditindaklanjuti sebelum periode payroll ditutup.", "Effective minutes = Pending orders (plan) + Approved/Paid (verified). Findings must be resolved before the payroll period closes.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="number">Total Lembur (jam)</TH>
              <TH align="center">Puncak Harian</TH><TH align="center">Puncak Mingguan</TH>
              <TH>Temuan Pelanggaran</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, idx) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", r.status === "violation" && "bg-red-50/40")}>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="number" className="font-black">{f.num(r.monthlyHours)}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{r.peakDaily ? `${f.dt(r.peakDaily.date)} · ${f.num(r.peakDaily.hours)} j` : <Dash />}</TD>
                <TD align="center" className="font-mono text-[9px]">{r.peakWeekly ? `${r.peakWeekly.weekLabel} · ${f.num(r.peakWeekly.hours)} j` : <Dash />}</TD>
                <TD className="max-w-72 text-[9px] leading-snug">
                  {r.violations.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-3">
                      {r.violations.map((v, i) => (
                        <li key={i} className="font-bold text-red-600">{v.detail}</li>
                      ))}
                    </ul>
                  ) : <span className="text-slate-400">—</span>}
                </TD>
                <TD align="center"><DocBadge tone={ST_TONE[r.status]}>{t(...ST_LABEL[r.status])}</DocBadge></TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada perintah lembur pada bulan ini.", "No overtime orders in this month.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Dasar hukum: UU 13/2003 Ps.78 (waktu kerja 40 jam/minggu), PP 35/2021 Ps.26–27 (lembur maks 4 jam/hari & 18 jam/minggu), Kepmen 102/2004. Pelanggaran berulang berpotensi sanksi administratif Depnaker.", "Legal basis: Law 13/2003 Art.78 (40-hour week), GR 35/2021 Art.26–27 (max 4 hrs/day & 18 hrs/week), Kepmen 102/2004. Repeat violations risk labour-office administrative sanctions.")} />
    </ReportSheet>
  );
}

// ================= AR4.1 Roster & Shift Schedule Deviation =================
export function AR41View({ data, meta }: { data: AR41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const TYPE_TONE: Record<string, "red" | "amber" | "slate" | "violet"> = { absent: "red", late: "amber", early: "slate", "no-punch": "amber", "off-work": "violet" };
  return (
    <ReportSheet docId="ar41" landscape>
      <DocHeader meta={meta} reportNo="R4.1" title="Roster & Shift Schedule Deviation Report" subtitle={t("Ketidaksesuaian Jadwal Shift Terencana vs Presensi Riil di Lapangan", "Planned Shift Roster vs Actual Field Presence Mismatch")} audience={t("Manajer Operasional · Supervisor Shift · HR", "Operations Managers · Shift Supervisors · HR")} docNo={mkDocNo("ar41", meta)} />

      <DocSection no="A" title={t("Ringkasan Deviasi", "Deviation Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hari Terjadwal", "Rostered Days"), value: f.num(data.rosterDays), accent: true }]} />
        {data.byType.map((b) => (
          <SummaryBox key={b.type} className="grid-cols-1" items={[{ label: b.label, value: f.num(b.count) }]} />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sesuai Jadwal", "On Roster"), value: data.onRosterPct != null ? f.pct(data.onRosterPct) : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Log Deviasi (urut tanggal)", "Deviation Log (by date)")} note={t("Roster dari siklus jadwal karyawan (Schedule Assignment); presensi riil dari rekap clock log terverifikasi.", "Roster from the employee schedule cycle (Schedule Assignment); actual presence from verified clock-log recaps.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Roster</TH><TH align="center">Jam Shift</TH>
              <TH align="center">Masuk</TH><TH align="center">Pulang</TH>
              <TH align="center">Jenis Deviasi</TH><TH>Rincian</TH><TH align="center">Severity</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.employeeNo}-${i.date}-${i.type}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.severity === "tinggi" && "bg-red-50/40")}>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.rosterCode}</TD>
                <TD align="center" className="font-mono text-[9.5px]">{i.rosterShift}</TD>
                <TD align="center" className="font-mono">{i.actualIn ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{i.actualOut ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={TYPE_TONE[i.type] ?? "slate"}>{data.byType.find((b) => b.type === i.type)?.label ?? i.type}</DocBadge></TD>
                <TD className="max-w-72 text-[9px] leading-snug text-slate-600">{i.detail}</TD>
                <TD align="center"><DocBadge tone={SEV_TONE[i.severity]}>{t(...SEV_LABEL[i.severity])}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada deviasi jadwal pada rentang ini — presensi 100% sesuai roster.", "No roster deviations in this range — presence 100% on roster.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Deviasi tinggi (tidak hadir / telat > 30 menit) memerlukan konfirmasi supervisor shift sebelum dihitung sebagai pelanggaran; kerja hari off wajib disertai SPK lembur.", "High deviations (no-show / > 30-min late) require shift supervisor confirmation before counting as violations; off-day work requires an overtime order.")} />
    </ReportSheet>
  );
}

// ================= AR4.2 Night Shift & Special Premium Hours Log =================
export function AR42View({ data, meta }: { data: AR42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="ar42" landscape>
      <DocHeader meta={meta} reportNo="R4.2" title="Night Shift & Special Premium Hours Log" subtitle={t("Rekap Shift Malam & Hari Libur Nasional — Penentuan Insentif / Tunjangan Khusus", "Night Shift & National Holiday Recap — Special Incentive / Allowance Determination")} audience={t("Payroll · HR · Manajer Operasional", "Payroll · HR · Operations Managers")} docNo={mkDocNo("ar42", meta)} />

      <DocSection no="A" title={t("Ringkasan Jam Premium", "Premium Hours Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Shift Malam (hari)", "Night Shift (days)"), value: f.num(data.nightCount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jam Shift Malam", "Night Shift Hours"), value: `${f.num(data.nightHours)} ${t("jam", "hrs")}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kerja Hari Libur (hari)", "Holiday Work (days)"), value: f.num(data.holidayCount) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jam Hari Libur", "Holiday Hours"), value: `${f.num(data.holidayHours)} ${t("jam", "hrs")}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Terdampak", "Affected Employees"), value: f.num(data.employees) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Lembur Terverifikasi", "Verified Overtime"), value: `${f.num(data.otVerifiedHours)} ${t("jam", "hrs")}`, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Log Jam Premium (urut tanggal)", "Premium Hours Log (by date)")} note={t("Layak insentif = hadir tercatat pada shift malam (22:00–06:00) atau hari libur nasional. Tarif insentif mengikuti kebijakan komponen upah perusahaan.", "Incentive-eligible = recorded presence on night shift (22:00–06:00) or national holiday. Incentive rates follow company wage-component policy.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>Kategori Premium</TH>
              <TH align="center">Masuk</TH><TH align="center">Pulang</TH>
              <TH align="number">Jam Kerja</TH><TH align="number">Lembur Verif. (jam)</TH><TH align="center">Insentif</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.employeeNo}-${i.date}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.category === "holiday" && "bg-violet-50/40")}>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD className="max-w-64 text-[9.5px]">
                  <DocBadge tone={i.category === "night" ? "sky" : "violet"}>{i.category === "night" ? t("Shift Malam", "Night Shift") : t("Libur Nasional", "National Holiday")}</DocBadge>
                  <span className="ml-1.5 text-slate-600">{i.categoryLabel}</span>
                </TD>
                <TD align="center" className="font-mono">{i.checkIn ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{i.checkOut ?? <Dash />}</TD>
                <TD align="number" className="font-bold">{f.num(i.hours)}</TD>
                <TD align="number">{i.otHours ? f.num(i.otHours) : <Dash />}</TD>
                <TD align="center"><DocBadge tone="green">{t("Layak", "Eligible")}</DocBadge></TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada jam premium (shift malam / hari libur) pada rentang ini.", "No premium hours (night shift / holiday) in this range.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("UU 13/2003 Ps.76–78: pekerja shift malam berhak istirahat antar hari & perlakuan khusus; upah lembur hari libur dihitung terpisah (indeks 2×/3×/4× — lihat R3.2). Tunjangan malam mengikuti kebijakan perusahaan.", "Law 13/2003 Art.76–78: night-shift workers are entitled to rest between days & special treatment; holiday overtime is computed separately (2×/3×/4× index — see R3.2). Night allowance follows company policy.")} />
    </ReportSheet>
  );
}

// ================= AR4.3 Attendance Exception Report =================
export function AR43View({ data, meta }: { data: AR43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const TYPE_TONE: Record<string, "red" | "amber" | "slate"> = { "missing-out": "red", "no-punch": "amber", revised: "slate" };
  return (
    <ReportSheet docId="ar43" landscape>
      <DocHeader meta={meta} reportNo="R4.3" title="Attendance Exception Report" subtitle={t("Transaksi Presensi Janggal — Lupa Clock-out · Import Tanpa Punch · Koreksi Manual", "Odd Attendance Transactions — Missing Clock-out · Punch-less Imports · Manual Corrections")} audience={t("HR Operations · Supervisor · Auditor", "HR Operations · Supervisors · Auditor")} docNo={mkDocNo("ar43", meta)} />

      <DocSection no="A" title={t("Ringkasan Anomali", "Exception Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Anomali", "Total Exceptions"), value: f.num(data.total), accent: true }]} />
        {data.counts.map((c) => (
          <SummaryBox key={c.type} className="grid-cols-1" items={[{ label: c.label, value: f.num(c.count) }] } />
        ))}
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Terlibat", "Employees Involved"), value: f.num(data.employees) }]} />
      </div>

      <DocSection no="B" title={t("Log Anomali (urut tanggal)", "Exception Log (by date)")} note={t("Setiap anomali memerlukan tindak lanjut terdokumentasi sebelum periode payroll ditutup — koreksi timesheet disetujui supervisor.", "Every exception requires documented follow-up before the payroll period closes — timesheet corrections approved by supervisors.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">Tanggal</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Jenis Anomali</TH><TH>Rincian</TH><TH align="center">Severity</TH><TH>Tindak Lanjut</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.employeeNo}-${i.date}-${i.type}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", i.severity === "tinggi" && "bg-red-50/40")}>
                <TD align="center">{f.dt(i.date)}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD>{i.unit ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={TYPE_TONE[i.type] ?? "slate"}>{i.typeLabel}</DocBadge></TD>
                <TD className="max-w-72 text-[9.5px] leading-snug text-slate-600">{i.detail}</TD>
                <TD align="center"><DocBadge tone={SEV_TONE[i.severity]}>{t(...SEV_LABEL[i.severity])}</DocBadge></TD>
                <TD className="max-w-64 text-[9px] leading-snug text-slate-500">{i.action}</TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada anomali presensi pada rentang/filter ini.", "No attendance exceptions in this range/filter.")}</TD></tr>
            )}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Anomali tinggi (lupa clock-out) mengakibatkan hari dihitung absen penuh oleh engine — koreksi manual WAJIB agar hak upah karyawan tidak terpotong (audit keadilan upah).", "High exceptions (missing clock-out) cause the engine to count the day as fully absent — manual correction is REQUIRED to protect the employee's wage rights (pay-fairness audit).")} />
    </ReportSheet>
  );
}
