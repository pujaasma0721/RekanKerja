"use client";
// T104 — views dokumen Grup 3 (Pergerakan) + Grup 4 (Kepatuhan Legal) ========
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { fmtIDR } from "@/rekankerja/shared/lib/api";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "./doc-kit";
import { mkDocNo } from "./report-views-g12";
import type { DocMeta, R31Data, R32Data, R33Data, R34Data, R41Data, R42Data, R43Data, R44Data } from "./types";

// ================= R3.1 New Hire Welcoming =================
export function R31View({ data, meta }: { data: R31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r31">
      <DocHeader meta={meta} reportNo="R3.1" title="New Hire Welcoming Report" subtitle={t("Ringkasan Karyawan Baru & Proses Onboarding", "New Joiners & Onboarding Progress")} audience={t("HR · Supervisor · IT · GA", "HR · Supervisors · IT · GA")} docNo={mkDocNo("r31", meta)} />

      <DocSection no="A" title={t("Ringkasan Penyambutan", "Welcoming Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Baru Bulan Ini", "New Hires This Month"), value: f.num(data.thisMonth), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kuartal Ini (QTD)", "This Quarter (QTD)"), value: f.num(data.qtd) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("90 Hari Terakhir", "Last 90 Days"), value: f.num(data.last90) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Berstatus Probation", "On Probation"), value: f.num(data.probation) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Karyawan Baru & Progres Checklist Onboarding", "New Joiners & Onboarding Checklist Progress")} note={t("Checklist onboarding mencakup penyediaan per bagian: IT, GA, HR, Payroll & Supervisor.", "The onboarding checklist covers provisioning per department: IT, GA, HR, Payroll & Supervisor.")} />
      <DocTable head={(
        <>
          <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH align="center">L/P</TH>
          <TH align="center">Tgl Masuk</TH><TH>Posisi</TH><TH>Unit</TH><TH>Atasan</TH>
          <TH align="center">Status</TH><TH align="center">Checklist Onboarding</TH>
        </>
      )}>
        {data.items.length === 0 && (
          <tr><TD colSpan={10} align="center" className="py-6 text-slate-400">{t("Belum ada karyawan baru pada periode ini.", "No new hires in this period.")}</TD></tr>
        )}
        {data.items.map((e, i) => {
          const ob = e.onboarding;
          const pct = ob && ob.total > 0 ? Math.round((ob.done / ob.total) * 100) : null;
          return (
            <tr key={e.employeeNo} className="hover:bg-slate-50">
              <TD align="center" className="text-slate-400">{i + 1}</TD>
              <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
              <TD className="font-semibold text-slate-800">{e.name}</TD>
              <TD align="center">{e.gender === "Perempuan" ? "P" : "L"}</TD>
              <TD align="center" className="font-bold">{f.dt(e.joinDate)}</TD>
              <TD>{e.position ?? <Dash />}</TD>
              <TD>{e.unit ?? <Dash />}</TD>
              <TD>{e.manager ?? <Dash />}</TD>
              <TD align="center"><DocBadge tone={e.employmentStatus === "Probation" ? "amber" : e.employmentStatus === "Contract" ? "sky" : "green"}>{e.employmentStatus}</DocBadge></TD>
              <TD align="center">
                {ob ? (
                  <div className="inline-block min-w-[110px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-bold tabular-nums text-slate-600">{ob.done}/{ob.total}</span>
                      <span className={cn("text-[8.5px] font-extrabold", pct === 100 ? "text-emerald-600" : pct != null && pct >= 50 ? "text-sky-600" : "text-amber-600")}>{pct}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={cn("h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-sky-500")} style={{ width: `${Math.max(4, pct ?? 0)}%` }} />
                    </div>
                  </div>
                ) : <span className="text-slate-300">—</span>}
              </TD>
            </tr>
          );
        })}
      </DocTable>

      <DocSection no="C" title={t("Tindak Lanjut Penyambutan", "Onboarding Follow-ups")} />
      <ul className="ml-4 list-disc space-y-1 text-[10px] leading-relaxed text-slate-700">
        <li>{t("Pastikan checklist onboarding selesai sebelum akhir bulan pertama (akun, perangkat, BPJS, payroll).", "Ensure the onboarding checklist completes within the first month (accounts, devices, BPJS, payroll).")}</li>
        <li>{t("Jadwalkan sesi orientasi & perkenalan tim (induction) pada minggu pertama.", "Schedule the orientation & team introduction (induction) in week one.")}</li>
        <li>{t("Registrasi BPJS wajib diajukan maksimal 14 hari sejak tanggal mulai bekerja.", "BPJS registration must be filed within 14 days of the start date.")}</li>
      </ul>

      <DocFooter meta={meta} />
    </ReportSheet>
  );
}

// ================= R3.2 Termination & Exit Interview =================
export function R32View({ data, meta }: { data: R32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r32">
      <DocHeader meta={meta} reportNo="R3.2" title="Employee Termination & Exit Interview Summary" subtitle={t("Keluar · Alasan · Exit Interview · Status Handover", "Exits · Reasons · Exit Interviews · Handover Status")} audience={t("HR · Direksi", "HR · Directorate")} docNo={mkDocNo("r32", meta)} />

      <DocSection no="A" title={t(`Ringkasan ${meta.year} YTD`, `${meta.year} YTD Summary`)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Keluar YTD", "Exits YTD"), value: f.num(data.ytdExits), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Resign", "Resigned"), value: f.num(data.resigned) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terminasi", "Terminated"), value: f.num(data.terminated) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Exit Interview Terisi", "Exit Interviewed"), value: f.num(data.withInterview) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepuasan Rata-rata", "Avg Satisfaction") , value: data.avgSatisfaction != null ? `${data.avgSatisfaction.toLocaleString("id-ID")}/5` : <Dash /> }]} />
      </div>

      <DocSection no="B" title={t("Distribusi Alasan Keluar", "Exit Reason Distribution")} />
      <div className="flex flex-wrap gap-1.5">
        {data.byReason.length === 0 && <span className="text-[10px] text-slate-400">{t("Belum ada keluar YTD.", "No YTD exits.")}</span>}
        {data.byReason.map((r) => (
          <span key={r.label} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9.5px] font-bold text-slate-700">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />{r.label} · {r.count}
          </span>
        ))}
      </div>

      <DocSection no="C" title={t("Daftar Keluar & Hasil Exit Interview", "Exit Register & Interview Results")} />
      <DocTable head={(
        <>
          <TH>No. Karyawan</TH><TH>Nama</TH><TH align="center">Status</TH>
          <TH align="center">Masuk</TH><TH align="center">Keluar</TH><TH align="number">Masa Kerja</TH>
          <TH>Unit</TH><TH>Alasan Keluar (Exit Reason)</TH><TH>Ringkasan Exit Interview</TH><TH align="center">Handover</TH>
        </>
      )}>
        {data.items.length === 0 && (
          <tr><TD colSpan={10} align="center" className="py-6 text-slate-400">{t("Tidak ada data karyawan keluar dalam cakupan akses.", "No exit data within your access scope.")}</TD></tr>
        )}
        {data.items.map((it) => (
          <tr key={it.employeeNo} className={cn("hover:bg-slate-50", it.status === "Terminated" && "bg-rose-50/40")}>
            <TD className="font-bold text-slate-800">{it.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{it.name}</TD>
            <TD align="center"><DocBadge tone={it.status === "Resigned" ? "amber" : "rose"}>{it.status === "Resigned" ? t("Resign", "Resigned") : t("Terminasi", "Terminated")}</DocBadge></TD>
            <TD align="center">{f.dt(it.joinDate)}</TD>
            <TD align="center" className="font-bold">{f.dt(it.endDate)}</TD>
            <TD align="number">{it.tenureYears.toLocaleString("id-ID")} thn</TD>
            <TD>{it.unit ?? <Dash />}</TD>
            <TD>{it.exitReason ?? <Dash />}</TD>
            <TD>
              {it.interview ? (
                <div className="min-w-[170px] space-y-0.5 text-[9.5px] leading-snug text-slate-600">
                  <p><span className="font-bold text-slate-700">{t("Alasan", "Reason")}:</span> {it.interview.reason ?? "—"}</p>
                  <p><span className="font-bold text-slate-700">{t("Rencana", "Plan")}:</span> {it.interview.nextPlan ?? "—"}</p>
                  {it.interview.feedback && <p><span className="font-bold text-slate-700">{t("Umpan balik", "Feedback")}:</span> {it.interview.feedback}</p>}
                  <p><span className="font-bold text-slate-700">{t("Kepuasan", "Satisfaction")}:</span> {it.interview.satisfaction ?? "—"}/5</p>
                </div>
              ) : <span className="text-slate-300">{t("Belum ada", "None")}</span>}
            </TD>
            <TD align="center">
              {it.handoverPct != null ? (
                <div>
                  <span className={cn("text-[10px] font-black tabular-nums", it.handoverPct === 100 ? "text-emerald-600" : "text-amber-600")}>{it.handoverPct}%</span>
                  <p className="text-[8px] font-bold text-slate-400">{it.handoverDone}/{it.handoverTotal} {t("tugas", "tasks")}</p>
                </div>
              ) : <span className="text-slate-300">—</span>}
            </TD>
          </tr>
        ))}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Data exit interview bersifat rahasia — hanya untuk analisis retensi HR & manajemen.", "Exit interview data is confidential — for HR retention analytics & management only.")} />
    </ReportSheet>
  );
}

// ================= R3.3 Turnover Executive Summary =================
function rateCell(rate: number | null) {
  if (rate == null) return <span className="text-slate-300">—</span>;
  const tone = rate <= 0 ? "text-slate-300" : rate < 2 ? "text-slate-600" : rate < 5 ? "font-bold text-amber-600" : "font-black text-red-600";
  const bg = rate <= 0 ? "" : rate < 2 ? "" : rate < 5 ? "bg-amber-50" : "bg-red-50";
  return <span className={cn("inline-block min-w-[30px] rounded px-1 tabular-nums", tone, bg)}>{rate.toLocaleString("id-ID")}</span>;
}

export function R33View({ data, meta }: { data: R33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const k = data.kpi;
  return (
    <ReportSheet docId="r33" landscape>
      <DocHeader meta={meta} reportNo="R3.3" title="Employee Turnover Executive Summary" subtitle={t("Turnover Rate Bulanan per Divisi — 12 Bulan", "Monthly Turnover Rate per Division — 12 Months")} audience={t("Direksi · Manajemen Senior", "Directorate · Senior Management")} docNo={mkDocNo("r33", meta)} />

      <DocSection no="A" title={t("Indikator Utama", "Key Indicators")} note={t("Turnover rate = jumlah keluar ÷ rata-rata headcount.", "Turnover rate = exits ÷ average headcount.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("HC Awal Tahun", "HC at Year Start"), value: f.num(k.startHC) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("HC Kini", "Current HC"), value: f.num(k.nowHC), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hires YTD", "Hires YTD"), value: f.num(k.hiresYtd) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Exits YTD", "Exits YTD"), value: f.num(k.exitsYtd) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata HC", "Average HC"), value: f.num(k.avgHC) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Turnover Rate YTD", "YTD Turnover Rate"), value: f.pct(k.turnoverRate) }]} />
      </div>

      <DocSection no="B" title={t("Matriks Turnover Bulanan per Divisi (%)", "Monthly Turnover Rate Matrix per Division (%)")} note={t("Angka = exits bulan tsb ÷ headcount awal bulan × 100. Diarsir = perlu perhatian.", "Value = that month's exits ÷ start-of-month headcount × 100. Tinted cells need attention.")} />
      <div className="doc-scroll max-h-[480px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>{t("Divisi", "Division")}</TH>
              {data.months.map((m) => <TH key={m.key} align="center">{m.label}</TH>)}
              <TH align="number">{t("HC", "HC")}</TH>
              <TH align="number">{t("Exits YTD", "Exits YTD")}</TH>
              <TH align="number">{t("Rate YTD", "YTD Rate")}</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.division} className="hover:bg-slate-50">
                <TD className="font-semibold text-slate-800">{r.division}</TD>
                {r.cells.map((c, i) => (
                  <TD key={i} align="center">{rateCell(c.rate)}</TD>
                ))}
                <TD align="number" className="font-bold">{f.num(r.headcount)}</TD>
                <TD align="number" className={cn(r.exitsYtd > 0 && "font-bold text-rose-600")}>{r.exitsYtd}</TD>
                <TD align="number" className="font-black">{r.rateYtd.toLocaleString("id-ID")}%</TD>
              </tr>
            ))}
            <tr className="bg-slate-100/90 hover:bg-slate-100/90">
              <TD className="text-[10.5px] font-black uppercase text-slate-900">{t("Total Perusahaan", "Company Total")}</TD>
              {data.companyCells.map((c, i) => (
                <TD key={i} align="center">{rateCell(c.rate)}</TD>
              ))}
              <TD align="number" className="font-black">{f.num(k.nowHC)}</TD>
              <TD align="number" className="font-black">{f.num(k.exitsYtd)}</TD>
              <TD align="number" className="font-black">{k.turnoverRate.toLocaleString("id-ID")}%</TD>
            </tr>
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Catatan Eksekutif", "Executive Notes")} />
      <ul className="ml-4 list-disc space-y-1 text-[10px] leading-relaxed text-slate-700">
        <li>{t("Benchmark informal: turnover manufaktur sehat umumnya < 10–12% per tahun; cell merah (≥ 5%/bulan) menandakan risiko retensi divisi tsb.", "Informal benchmark: healthy manufacturing turnover is < 10–12% per year; red cells (≥ 5%/month) flag divisional retention risk.")}</li>
        <li>{t("Cross-check dengan Laporan Exit Interview (R3.2) untuk pola alasan keluar.", "Cross-check with the Exit Interview Report (R3.2) for exit-reason patterns.")}</li>
      </ul>

      <DocFooter meta={meta} signNote={t("Angka dihitung dari data lifecycle karyawan dalam cakupan akses pengunduh.", "Figures computed from employee lifecycle data within the downloader's access scope.")} />
    </ReportSheet>
  );
}

// ================= R3.4 Movement History Log =================
const MOVE_TONE: Record<string, { tone: "green" | "rose" | "sky" | "violet"; id: string; en: string }> = {
  Promotion: { tone: "green", id: "Promosi", en: "Promotion" },
  Demotion: { tone: "rose", id: "Demosi", en: "Demotion" },
  Transfer: { tone: "sky", id: "Rotasi", en: "Transfer" },
  Mutation: { tone: "violet", id: "Mutasi", en: "Mutation" },
};

export function R34View({ data, meta }: { data: R34Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r34">
      <DocHeader meta={meta} reportNo="R3.4" title="Promotion, Demotion & Transfer History Log" subtitle={t("Riwayat Pergerakan Karyawan (Unit · Posisi · Grade)", "Employee Movement History (Unit · Position · Grade)")} audience={t("HR · Direksi · Audit", "HR · Directorate · Audit")} docNo={mkDocNo("r34", meta)} />

      <DocSection no="A" title={t("Ringkasan Pergerakan", "Movement Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Pergerakan", "Total Movements"), value: f.num(data.total), accent: true }]} />
        {data.byReason.map((r) => {
          const st = MOVE_TONE[r.label];
          return <SummaryBox key={r.label} className="grid-cols-1" items={[{ label: t(st.id, st.en), value: f.num(r.count) }]} />;
        })}
      </div>

      <DocSection no="B" title={t("Log Riwayat (terbaru dulu)", "History Log (latest first)")} note={t("Setiap baris = penempatan baru; kolom asal mengacu pada penempatan sebelumnya.", "Each row = a new placement; the from columns refer to the previous placement.")} />
      <DocTable head={(
        <>
          <TH align="center">Tanggal Efektif</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH align="center">Jenis</TH>
          <TH>Unit: Asal → Tujuan</TH><TH>Posisi: Asal → Tujuan</TH><TH align="center">Grade</TH><TH align="center">No. Dokumen</TH><TH>Catatan</TH>
        </>
      )}>
        {data.items.length === 0 && (
          <tr><TD colSpan={9} align="center" className="py-6 text-slate-400">{t("Belum ada riwayat promosi/demosi/rotasi/mutasi.", "No promotion/demotion/transfer history yet.")}</TD></tr>
        )}
        {data.items.map((it, i) => {
          const st = MOVE_TONE[it.reason] ?? { tone: "slate" as const, id: it.reason, en: it.reason };
          return (
            <tr key={`${it.employeeNo}-${it.effectiveDate}-${i}`} className="hover:bg-slate-50">
              <TD align="center" className="font-bold">{f.dt(it.effectiveDate)}</TD>
              <TD className="font-bold text-slate-800">{it.employeeNo}</TD>
              <TD className="font-semibold text-slate-800">{it.name}</TD>
              <TD align="center"><DocBadge tone={st.tone}>{t(st.id, st.en)}</DocBadge></TD>
              <TD>
                <div className="min-w-[150px] text-[9.5px] leading-snug">
                  <p className="text-slate-400 line-through">{it.fromUnit ?? "—"}</p>
                  <p className="font-bold text-slate-700">→ {it.toUnit ?? "—"}</p>
                </div>
              </TD>
              <TD>
                <div className="min-w-[160px] text-[9.5px] leading-snug">
                  <p className="text-slate-400 line-through">{it.fromPosition ?? "—"}</p>
                  <p className="font-bold text-slate-700">→ {it.toPosition ?? "—"}</p>
                </div>
              </TD>
              <TD align="center">
                {it.fromGrade || it.toGrade ? (
                  <span className="font-mono text-[9px] font-bold">{it.fromGrade ?? "—"} <span className="text-slate-300">→</span> {it.toGrade ?? "—"}</span>
                ) : <Dash />}
              </TD>
              <TD align="center" className="font-mono text-[9px]">{it.docNo ?? <Dash />}</TD>
              <TD className="max-w-[180px] text-[9.5px] text-slate-500">{it.notes ?? <Dash />}</TD>
            </tr>
          );
        })}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Log bersumber dari riwayat EmployeeAssignment ( Personnel Action terproses).", "Sourced from the EmployeeAssignment history (processed Personnel Actions).")} />
    </ReportSheet>
  );
}

// ================= R4.1 WLKP =================
export function R41View({ data, meta }: { data: R41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const gp = (p: { male: number; female: number }) => [f.num(p.male), f.num(p.female), f.num(p.male + p.female)];
  return (
    <ReportSheet docId="r41">
      <DocHeader meta={meta} reportNo="R4.1" title="WLKP — Wajib Lapor Ketenagakerjaan" subtitle={t("Form Datar Resmi — UU No. 7/1981 jo. UU No. 25/1997", "Official Flat Form — Law No. 7/1981 & Law No. 25/1997")} audience={t("Kemnaker / Disnaker · Direksi", "Manpower Office · Directorate")} docNo={mkDocNo("r41", meta)} />

      <DocSection no="I" title={t("Identitas Perusahaan", "Company Identity")} />
      <div className="grid gap-px overflow-hidden rounded-lg border border-slate-300 bg-slate-300 sm:grid-cols-2">
        {[
          [t("Nama Perusahaan", "Company Name"), data.identity.name],
          [t("Alamat", "Address"), data.identity.address ?? "—"],
          [t("Kota", "City"), data.identity.city ?? "—"],
          ["NPWP", data.identity.taxId ?? "—"],
          [t("Kantor / Cabang Terdaftar", "Registered Offices"), data.identity.offices.join(" · ")],
          [t("Periode Laporan", "Report Period"), meta.periodLabel],
        ].map(([l, v]) => (
          <div key={l} className="grid grid-cols-[130px_1fr] bg-white">
            <div className="border-r border-slate-200 bg-slate-50 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-500">{l}</div>
            <div className="px-3 py-1.5 text-[10.5px] font-semibold text-slate-800">{v}</div>
          </div>
        ))}
      </div>

      <DocSection no="II" title={t("Data Pekerja (A)", "Worker Data (A)")} note={t("Jumlah pekerja aktif per status kepegawaian & jenis kelamin.", "Active workers by employment status & gender.")} />
      <DocTable head={<><TH>Kategori Pekerja</TH><TH align="number">Laki-laki</TH><TH align="number">Perempuan</TH><TH align="number">Jumlah</TH></>}>
        <tr className="hover:bg-slate-50"><TD className="font-semibold">A.1 {t("Pekerja Tetap (PKWTT)", "Permanent Workers")}</TD>{gp(data.workers.permanent).map((v, i) => <TD key={i} align="number">{v}</TD>)}</tr>
        <tr className="hover:bg-slate-50"><TD className="font-semibold">A.2 {t("Pekerja PKWT / Kontrak", "Fixed-Term (PKWT) Workers")}</TD>{gp(data.workers.contract).map((v, i) => <TD key={i} align="number">{v}</TD>)}</tr>
        <tr className="hover:bg-slate-50"><TD className="font-semibold">A.3 {t("Pekerja Masa Percobaan / Magang", "Probation / Apprentice Workers")}</TD>{gp(data.workers.probation).map((v, i) => <TD key={i} align="number">{v}</TD>)}</tr>
        <tr className="hover:bg-slate-50"><TD className="font-semibold">A.4 {t("Pekerja Outsourcing", "Outsourced Workers")}</TD>{gp(data.workers.outsourcing).map((v, i) => <TD key={i} align="number">{v}</TD>)}</tr>
        <TotalRow label={t("Jumlah (A)", "Total (A)")} cells={[data.workersTotal]} spanLabel={3} />
      </DocTable>

      <DocSection no="III" title={t("Distribusi Upah (B)", "Wage Distribution (B)")} note={data.umk ? t(`Acuan: ${data.umk.label} — ${fmtIDR(data.umk.monthlyAmount)}/bulan.`, `Reference: ${data.umk.label} — ${fmtIDR(data.umk.monthlyAmount)}/month.`) : t("Acuan UMK belum dikonfigurasi.", "Minimum-wage reference not configured.")} />
      <DocTable head={<><TH>Kelas Upah Bulanan</TH><TH align="number">Laki-laki</TH><TH align="number">Perempuan</TH><TH align="number">Jumlah</TH></>}>
        {data.wageBuckets.map((b) => (
          <tr key={b.label} className="hover:bg-slate-50">
            <TD className="font-semibold">B — {b.label}</TD>
            <TD align="number">{f.num(b.male)}</TD>
            <TD align="number">{f.num(b.female)}</TD>
            <TD align="number">{f.num(b.total)}</TD>
          </tr>
        ))}
        <TotalRow label={t("Jumlah (B)", "Total (B)")} cells={[data.wageTotal]} spanLabel={3} />
      </DocTable>

      <DocSection no="IV" title={t("Kepesertaan Jaminan Sosial (C)", "Social Security Membership (C)")} />
      <DocTable head={<><TH>Program</TH><TH align="number">{t("Terdaftar", "Registered")}</TH><TH align="number">{t("Belum Terdaftar", "Not Registered")}</TH><TH align="center">{t("Keterangan", "Note")}</TH></>}>
        <tr className="hover:bg-slate-50">
          <TD className="font-semibold">{t("C.1 BPJS Kesehatan", "C.1 BPJS Health")}</TD>
          <TD align="number">{f.num(data.bpjs.healthRegistered)}</TD>
          <TD align="number" className={data.bpjs.healthMissing > 0 ? "font-bold text-rose-600" : ""}>{f.num(data.bpjs.healthMissing)}</TD>
          <TD align="center">{data.bpjs.healthMissing > 0 ? <DocBadge tone="rose">{t("Perlu Tindak Lanjut", "Action Needed")}</DocBadge> : <DocBadge tone="green">{t("Sesuai", "Matched")}</DocBadge>}</TD>
        </tr>
        <tr className="hover:bg-slate-50">
          <TD className="font-semibold">C.2 BPJS Ketenagakerjaan (JKK · JKM · JHT · JP)</TD>
          <TD align="number">{f.num(data.bpjs.jkkRegistered)}</TD>
          <TD align="number" className={data.bpjs.jkkMissing > 0 ? "font-bold text-rose-600" : ""}>{f.num(data.bpjs.jkkMissing)}</TD>
          <TD align="center">{data.bpjs.jkkMissing > 0 ? <DocBadge tone="rose">{t("Perlu Tindak Lanjut", "Action Needed")}</DocBadge> : <DocBadge tone="green">{t("Sesuai", "Matched")}</DocBadge>}</TD>
        </tr>
      </DocTable>

      <DocSection no="V" title={t("Pernyataan (D)", "Statement (D)")} />
      <div className="rounded-lg border border-slate-300 p-4">
        <p className="text-[10px] leading-relaxed text-slate-700">
          {t(
            "Perusahaan menyatakan bahwa data yang dilaporkan pada formulir WLKP ini adalah benar dan sesuai dengan kondisi perusahaan pada periode laporan. Perusahaan memahami kewajiban penyampaian Wajib Lapor Ketenagakerjaan kepada Dinas Tenaga Kerja setempat sesuai UU No. 7 Tahun 1981 jo. UU No. 25 Tahun 1997.",
            "The company declares that the data reported in this WLKP form is true and reflects the company's condition for the reporting period, and acknowledges the obligation to file the Manpower Mandatory Report with the local Manpower Office under Law No. 7/1981 & Law No. 25/1997.",
          )}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-[9.5px] font-bold text-slate-600">{t("Pemberi Kerja", "Employer")}</p>
            <div className="mx-auto mt-8 mb-1 w-2/3 border-b border-dashed border-slate-400" />
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-slate-400">{t("Nama, tanda tangan & cap", "Name, signature & seal")}</p>
          </div>
          <div>
            <p className="text-[9.5px] font-bold text-slate-600">{t("Wakil Pekerja / Serikat Pekerja (bila ada)", "Worker / Union Representative (if any)")}</p>
            <div className="mx-auto mt-8 mb-1 w-2/3 border-b border-dashed border-slate-400" />
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-slate-400">{t("Nama & tanda tangan", "Name & signature")}</p>
          </div>
        </div>
      </div>

      <DocFooter meta={meta} signNote={t("Lampirkan daftar nominatif bila diminta petugas Disnaker. Batas lapor: tiap perubahan data pekerja (30 hari kerja).", "Attach the nominal roster if requested by the Manpower Office. Filing deadline: within 30 working days of any worker-data change.")} />
    </ReportSheet>
  );
}

// ================= R4.2 BPJS Reconciliation =================
export function R42View({ data, meta }: { data: R42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r42" landscape>
      <DocHeader meta={meta} reportNo="R4.2" title="BPJS Kesehatan & Ketenagakerjaan Reconciliation Sheet" subtitle={t("Rekoniliasi Karyawan Aktif Payroll vs Kepesertaan BPJS", "Active Payroll vs BPJS Membership Reconciliation")} audience={t("HR · Payroll · Finance", "HR · Payroll · Finance")} docNo={mkDocNo("r42", meta)} />

      <DocSection no="A" title={t("Hasil Rekoniliasi", "Reconciliation Result")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Aktif", "Active Employees"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sesuai (2 Program)", "Matched (Both)"), value: f.num(data.matched) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sebagian", "Partial"), value: f.num(data.partial) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Belum Terdaftar", "Unregistered"), value: f.num(data.missing) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepatuhan", "Compliance"), value: f.pct(data.compliancePct) }]} />
      </div>
      {(data.healthMissing > 0 || data.jkkMissing > 0) && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-[10px] font-semibold text-rose-700">
          {t(
            `Selisih terdeteksi: ${data.healthMissing} karyawan belum terdaftar BPJS Kesehatan, ${data.jkkMissing} belum terdaftar BPJS Ketenagakerjaan — segera proses pendaftaran (batas 14 hari sejak TMT) & sinkronkan iuran bulan berjalan.`,
            `Discrepancies detected: ${data.healthMissing} employees unregistered for BPJS Health, ${data.jkkMissing} for BPJS Employment — process registrations (14-day deadline from TMT) & sync the current month's premiums.`,
          )}
        </div>
      )}

      <DocSection no="B" title={t("Rincian Kepesertaan per Karyawan", "Membership Detail per Employee")} note={t("✓ = nomor kepesertaan terisi di data payroll; baris merah = belum terdaftar.", "✓ = membership number present in payroll data; red rows = unregistered.")} />
      <div className="doc-scroll max-h-[480px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="center">Status</TH>
              <TH align="center">BPJS Kesehatan</TH><TH align="center">BPJS Ketenagakerjaan</TH><TH align="center">Hasil Rekon</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={it.employeeNo} className={cn("hover:bg-slate-50", (it.status === "missing" || it.status === "partial") && "bg-rose-50/50")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{it.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{it.name}</TD>
                <TD>{it.unit ?? <Dash />}</TD>
                <TD align="center">{it.employmentStatus}</TD>
                <TD align="center">
                  {it.bpjsHealth ? <span className="font-mono text-[9px] text-slate-600">{it.bpjsHealth}</span> : <DocBadge tone="rose">{t("Belum terdaftar", "Unregistered")}</DocBadge>}
                </TD>
                <TD align="center">
                  {it.bpjsEmpSkill ? <span className="font-mono text-[9px] text-slate-600">{it.bpjsEmpSkill}</span> : <DocBadge tone="rose">{t("Belum terdaftar", "Unregistered")}</DocBadge>}
                </TD>
                <TD align="center">
                  {it.status === "match" ? <DocBadge tone="green">{t("Sesuai", "Matched")}</DocBadge>
                    : it.status === "partial" ? <DocBadge tone="amber">{t("Sebagian", "Partial")}</DocBadge>
                      : <DocBadge tone="rose">{t("Belum terdaftar", "Unregistered")}</DocBadge>}
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Langkah Koreksi", "Correction Steps")} />
      <ol className="ml-4 list-decimal space-y-1 text-[10px] leading-relaxed text-slate-700">
        <li>{t("Unduh daftar selisih (baris merah) dan ajukan pendaftaran BPJS via portal BPJPHU/BPJS-TK.", "Download the discrepancy list (red rows) and file registrations via the BPJSHU/BPJS-TK portal.")}</li>
        <li>{t("Samakan iuran bulan berjalan setelah nomor kepesertaan aktif (backdate sesuai TMT).", "Align the current month's premiums once membership numbers are active (backdated per TMT).")}</li>
        <li>{t("Arsipkan bukti pembayaran sebagai lampiran audit.", "Archive payment proof as audit attachments.")}</li>
      </ol>

      <DocFooter meta={meta} signNote={t("Rekoniliasi dilakukan terhadap data payroll aktif pada tanggal cetak.", "Reconciled against active payroll data as of the print date.")} />
    </ReportSheet>
  );
}

// ================= R4.3 Struktur & Skala Upah (SUSU) =================
export function R43View({ data, meta }: { data: R43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r43" landscape>
      <DocHeader meta={meta} reportNo="R4.3" title="Laporan Struktur dan Skala Upah" subtitle={t("Susunan & Rentang Upah per Grade — Panduan Kemnaker (PP 78/2015)", "Wage Structure & Scale per Grade — Kemnaker Guideline (GR 78/2015)")} audience={t("Kemnaker · Direksi · HR", "Manpower Office · Directorate · HR")} docNo={mkDocNo("r43", meta)} />

      {data.umk && (
        <div className="mt-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5">
          <p className="text-[10px] font-bold text-slate-700">
            {t("Acuan Upah Minimum", "Minimum Wage Reference")}: <span className="font-black">{data.umk.label}</span> — <span className="font-black">{fmtIDR(data.umk.monthlyAmount)}</span>{t("/bulan", "/month")}
          </p>
          <p className="mt-0.5 text-[9px] italic text-slate-500">
            {t("Struktur & skala upah disusun berdasarkan kelompok jabatan (grade) dengan memperhatikan masa kerja, kualifikasi, dan kinerja (PP 78/2015 Pasal 21).", "The wage structure & scale are arranged by job group (grade), taking into account tenure, qualification, and performance (GR 78/2015 Art. 21).")}
          </p>
        </div>
      )}

      {data.masked && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[10px] font-semibold text-amber-700">
          {t("Brankas Uang terkunci — nilai upah aktual disembunyikan. Buka Brankas Uang lalu segarkan laporan.", "Money Vault is locked — actual wage values are hidden. Unlock the Money Vault and refresh the report.")}
        </div>
      )}

      <DocSection no="A" title={t("Struktur & Skala Upah per Grade", "Wage Structure & Scale per Grade")} />
      <DocTable head={(
        <>
          <TH align="center">Grade</TH><TH>Nama Grade</TH><TH align="number">Upah Min.</TH><TH align="number">Titik Tengah</TH><TH align="number">Upah Maks.</TH>
          <TH align="number">Karyawan</TH><TH align="number">Aktual Min.</TH><TH align="number">Aktual Rata-rata</TH><TH align="number">Aktual Maks.</TH><TH align="center">Dibawah UMK</TH>
        </>
      )}>
        {data.grades.map((g) => (
          <tr key={g.code} className="hover:bg-slate-50">
            <TD align="center"><span className="rounded bg-slate-200 px-1.5 py-px font-mono text-[9px] font-black">{g.code}</span></TD>
            <TD className="font-semibold text-slate-800">{g.name}</TD>
            <TD align="number">{fmtIDR(g.minSalary)}</TD>
            <TD align="number" className="text-slate-500">{fmtIDR(g.midSalary)}</TD>
            <TD align="number">{fmtIDR(g.maxSalary)}</TD>
            <TD align="number" className="font-bold">{f.num(g.employees)}</TD>
            <TD align="number" className="text-slate-500">{g.actualMin != null ? fmtIDR(g.actualMin) : "—"}</TD>
            <TD align="number" className="font-bold">{g.actualAvg != null ? fmtIDR(g.actualAvg) : "—"}</TD>
            <TD align="number" className="text-slate-500">{g.actualMax != null ? fmtIDR(g.actualMax) : "—"}</TD>
            <TD align="center">
              {g.belowUmk > 0 ? <DocBadge tone="red">{f.num(g.belowUmk)}</DocBadge> : <DocBadge tone="green">0</DocBadge>}
            </TD>
          </tr>
        ))}
        <TotalRow label={t("Total", "Total")} cells={[data.total, "", "", "", ""]} spanLabel={5} />
      </DocTable>

      <DocSection no="B" title={t("Ringkasan Kepatuhan", "Compliance Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan di Grade", "Graded Employees"), value: f.num(data.total - data.noGrade) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tanpa Grade", "No Grade"), value: f.num(data.noGrade) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Upah < UMK", "Below Minimum Wage"), value: f.num(data.overallBelowUmk) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepatuhan UMK", "Minimum-Wage Compliance"), value: f.pct(data.total > 0 ? Math.round(((data.total - data.overallBelowUmk) / data.total) * 100) : 100) }]} />
      </div>
      {data.overallBelowUmk > 0 && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[9.5px] font-semibold text-red-700">
          {t(
            `Terdeteksi ${data.overallBelowUmk} karyawan dengan upah di bawah UMK — wajib disesuaikan paling lambat periode payroll berikutnya (UU 13/2003 Pasal 90; sanksi pidana Pasal 185).`,
            `${data.overallBelowUmk} employees earn below the minimum wage — must be corrected by the next payroll period (Law 13/2003 Art. 90; criminal sanction Art. 185).`,
          )}
        </p>
      )}

      <DocFooter meta={meta} signNote={t("Nilai aktual upah bersifat rahasia — distribusi terbatas sesuai kebijakan remunerasi perusahaan.", "Actual wage values are confidential — restricted distribution per the company's compensation policy.")} />
    </ReportSheet>
  );
}

// ================= R4.4 Competency & Certification Audit =================
const CERT_TONE: Record<string, { tone: "red" | "amber" | "green" | "slate"; id: string; en: string }> = {
  expired: { tone: "red", id: "Kedaluwarsa", en: "Expired" },
  expiring: { tone: "amber", id: "Segera Berakhir", en: "Expiring" },
  active: { tone: "green", id: "Aktif", en: "Active" },
  "no-expiry": { tone: "slate", id: "Tanpa Masa Berlaku", en: "No Expiry" },
};

export function R44View({ data, meta }: { data: R44Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r44" landscape>
      <DocHeader meta={meta} reportNo="R4.4" title="Employee Competency & Certification Audit Sheet" subtitle={t("Audit Lisensi Keselamatan (K3) & Sertifikat Profesional", "Safety (K3) Licenses & Professional Certificates Audit")} audience={t("HR · HSE/K3 · Audit", "HR · HSE · Audit")} docNo={mkDocNo("r44", meta)} />

      <DocSection no="A" title={t("Ringkasan Audit", "Audit Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dokumen Terdata", "Documents Tracked"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kedaluwarsa", "Expired"), value: f.num(data.expired) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Segera Berakhir (<90 hr)", "Expiring (<90d)"), value: f.num(data.expiring) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Aktif", "Active"), value: f.num(data.active) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepatuhan", "Compliance"), value: f.pct(data.compliancePct) }]} />
      </div>

      <DocSection no="B" title={t("Rekap per Kategori", "Category Recap")} />
      <div className="flex flex-wrap gap-1.5">
        {data.byCategory.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9.5px] font-bold text-slate-700">
            {c.label} · {c.total}
            {c.expired > 0 && <span className="text-red-600">({c.expired} {t("kedaluwarsa", "expired")})</span>}
            {c.expired === 0 && c.expiring > 0 && <span className="text-amber-600">({c.expiring} {t("segera", "soon")})</span>}
          </span>
        ))}
      </div>

      <DocSection no="C" title={t("Daftar Audit (prioritas: kedaluwarsa dulu)", "Audit Register (expired first)")} note={t("K3 = Keselamatan & Kesehatan Kerja. Lisensi kedaluwarsa wajib diperbarui sebelum pekerja ditugaskan kembali.", "K3 = Occupational Safety & Health. Expired licenses must be renewed before the worker is reassigned.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="center">Kategori</TH>
              <TH>Dokumen / Lisensi</TH><TH>No. Dokumen</TH><TH align="center">Terbit</TH><TH align="center">Berakhir</TH>
              <TH align="number">Sisa Hari</TH><TH align="center">Status</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr><td colSpan={11} className="py-6 text-center text-[10.5px] text-slate-400">{t("Belum ada dokumen/sertifikat terdata — mulai unggah dokumen karyawan.", "No documents/certificates recorded yet — start uploading employee documents.")}</td></tr>
            )}
            {data.items.map((it, i) => {
              const st = CERT_TONE[it.status];
              return (
                <tr key={`${it.employeeNo}-${it.docNumber}-${i}`} className={cn("hover:bg-slate-50", it.status === "expired" && "bg-red-50/60", it.status === "expiring" && "bg-amber-50/40")}>
                  <TD align="center" className="text-slate-400">{i + 1}</TD>
                  <TD className="font-bold text-slate-800">{it.employeeNo}</TD>
                  <TD className="font-semibold text-slate-800">{it.name}</TD>
                  <TD>{it.unit ?? <Dash />}</TD>
                  <TD align="center">
                    <span className="text-[8.5px] font-extrabold uppercase tracking-wide text-slate-500">{it.category.includes("K3") ? "K3" : it.category.split(" ")[0]}</span>
                  </TD>
                  <TD className="max-w-[240px] whitespace-normal break-words">{it.notes ?? it.docType}</TD>
                  <TD className="whitespace-nowrap font-mono text-[9px]">{it.docNumber ?? <Dash />}</TD>
                  <TD align="center">{f.dt(it.issuedAt)}</TD>
                  <TD align="center" className="font-bold">{f.dt(it.expiresAt)}</TD>
                  <TD align="number">{it.daysRemaining ?? <Dash />}</TD>
                  <TD align="center"><DocBadge tone={st.tone}>{t(st.id, st.en)}</DocBadge></TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Sertifikat K3 & lisensi keahlian wajib berlaku sesuai UU 1/1970 & Permenaker 4/1987 (unsur keselamatan kerja).", "K3 certificates & competency licenses must remain valid per Law 1/1970 & Manpower Minister Reg. 4/1987 (occupational safety elements).")} />
    </ReportSheet>
  );
}
