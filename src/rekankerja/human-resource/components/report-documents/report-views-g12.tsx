"use client";
// T104 — views dokumen Grup 1 (Demografi & Profil) + Grup 2 (Kontrak & Tenure) =
import { Fragment } from "react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "./doc-kit";
import type { DocMeta, R11Data, R12Data, R13Data, R14Data, R15Data, R21Data, R22Data, R23Data } from "./types";

/** No. dokumen deterministik: HR/R11/2026/10. */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `HR/${id.toUpperCase().replace("R", "R")}/${meta.year}/${mm}`;
}

const STAT_TONE: Record<string, "green" | "sky" | "amber" | "violet"> = {
  Permanent: "green", Contract: "sky", Probation: "amber", Outsourcing: "violet",
};

// ================= R1.1 Master Employee =================
export function R11View({ data, meta }: { data: R11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r11" landscape>
      <DocHeader meta={meta} reportNo="R1.1" title="Master Employee Report" subtitle={t("Sensus Karyawan Lengkap — Full Employee Census", "Full Employee Census")} audience={t("Direksi · HR · Audit Internal", "Directorate · HR · Internal Audit")} docNo={mkDocNo("r11", meta)} />

      <DocSection no="A" title={t("Ringkasan Sensus", "Census Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Aktif", "Active Employees"), value: f.num(data.totalActive), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: "Laki-laki", value: f.num(data.male) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: "Perempuan", value: f.num(data.female) }]} />
        {data.byStatus.map((s) => (
          <SummaryBox key={s.label} className="grid-cols-1" items={[{ label: s.label, value: f.num(s.count) }]} />
        ))}
        {data.noUnit > 0 && <SummaryBox className="grid-cols-1" items={[{ label: t("Tanpa Unit", "No Unit"), value: f.num(data.noUnit) }]} />}
      </div>

      <DocSection no="B" title={t("Daftar Karyawan (urut Unit & Nama)", "Employee Register (by Unit & Name)")} note={t("NIK disamarkan sesuai kebijakan PII — versi lengkap tersedia bagi pemegang hak akses data pegawai.", "NIK masked per PII policy — full version available to authorized roles.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Karyawan</TH><TH>Nama Lengkap</TH><TH>NIK</TH><TH align="center">L/P</TH>
              <TH align="center">Tgl Lahir</TH><TH align="number">Usia</TH><TH>Pendidikan</TH>
              <TH align="center">Status Kawin</TH><TH>Agama</TH><TH>Unit / Departemen</TH><TH>Posisi</TH>
              <TH align="center">Status</TH><TH align="center">Tgl Masuk</TH><TH align="number">Masa Kerja</TH>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e, i) => (
              <tr key={e.employeeNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{e.name}</TD>
                <TD className="font-mono text-[9.5px]">{e.nik ?? <Dash />}</TD>
                <TD align="center">{e.gender === "Perempuan" ? "P" : "L"}</TD>
                <TD align="center">{f.dt(e.birthDate)}</TD>
                <TD align="number">{e.age ?? <Dash />}</TD>
                <TD>{e.education}</TD>
                <TD align="center">{e.marital ?? <Dash />}</TD>
                <TD>{e.religion ?? <Dash />}</TD>
                <TD>{e.unit ?? <Dash />}</TD>
                <TD>{e.position ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={STAT_TONE[e.employmentStatus] ?? "slate"}>{e.employmentStatus}</DocBadge></TD>
                <TD align="center">{f.dt(e.joinDate)}</TD>
                <TD align="number">{e.tenureYears.toLocaleString("id-ID")} thn</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Sensus ini menggantikan dokumen sejenis yang diterbitkan sebelumnya.", "This census supersedes previously issued equivalents.")} />
    </ReportSheet>
  );
}

// ================= R1.2 Demography Summary =================
function DistBlock({ title, rows, total }: { title: string; rows: { label: string; count: number }[]; total: number }) {
  const f = useDocFmt();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700">{title}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-3.5 py-3 text-[10px] text-slate-400">Tidak ada data</p>}
        {rows.map((r) => (
          <div key={r.label} className="px-3.5 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10.5px] font-semibold text-slate-700">{r.label}</span>
              <span className="text-[10.5px] font-black tabular-nums text-slate-800">
                {f.num(r.count)}
                <span className="ml-1 text-[8.5px] font-bold text-slate-400">({total > 0 ? Math.round((r.count / total) * 100) : 0}%)</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-700" style={{ width: `${Math.max(3, (r.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function R12View({ data, meta }: { data: R12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r12">
      <DocHeader meta={meta} reportNo="R1.2" title="Employee Demography Summary" subtitle={t("Sebaran Demografi Karyawan Aktif", "Active Employee Demographic Distribution")} audience={t("Manajemen HR · Perencanaan SDM", "HR Management · Workforce Planning")} docNo={mkDocNo("r12", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Karyawan", "Total Employees"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Usia", "Average Age"), value: data.avgAge != null ? `${data.avgAge.toLocaleString("id-ID")} thn` : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Usia Termuda", "Youngest"), value: data.minAge != null ? `${data.minAge} thn` : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Usia Tertua", "Oldest"), value: data.maxAge != null ? `${data.maxAge} thn` : <Dash /> }]} />
      </div>

      <DocSection no="B" title={t("Sebaran per Dimensi", "Distribution by Dimension")} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <DistBlock title={t("Kelompok Usia", "Age Group")} rows={data.ageBuckets} total={data.total} />
        <DistBlock title={t("Jenis Kelamin", "Gender")} rows={data.gender} total={data.total} />
        <DistBlock title={t("Pendidikan Terakhir", "Highest Education")} rows={data.education} total={data.total} />
        <DistBlock title={t("Status Pernikahan", "Marital Status")} rows={data.marital} total={data.total} />
        <DistBlock title={t("Agama", "Religion")} rows={data.religion} total={data.total} />
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700">{t("Catatan Analis", "Analyst Note")}</p>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
            {t(
              "Komposisi demografi dihitung dari karyawan berstatus aktif per periode laporan. Sebaran usia & pendidikan menjadi dasar perencanaan suksesi dan program pengembangan.",
              "Demographic composition is computed from active employees as of the report period. Age & education distribution feed succession planning and development programs.",
            )}
          </p>
        </div>
      </div>

      <DocFooter meta={meta} />
    </ReportSheet>
  );
}

// ================= R1.3 Department & Position Distribution =================
function UnitTreeRows({ nodes, depth, f }: { nodes: R13Data["tree"]; depth: number; f: ReturnType<typeof useDocFmt> }) {
  return (
    <>
      {nodes.map((u) => (
        <Fragment key={u.code}>
          <tr className="bg-slate-50/80 hover:bg-slate-50">
            <TD className="font-bold text-slate-800">
              <span style={{ paddingLeft: depth * 14 }} className="inline-flex items-center gap-1.5">
                {depth > 0 && <span className="text-slate-300">└</span>}
                <span className="rounded bg-slate-200 px-1 py-px font-mono text-[8.5px] font-bold">{u.code}</span>
                {u.name}
              </span>
            </TD>
            <TD align="number" className="font-black text-slate-800">{f.num(u.headcount)}</TD>
            <TD align="number">{f.num(u.budget)}</TD>
            <TD align="center">
              <span className={cn("font-bold tabular-nums", u.budget > 0 && u.headcount > u.budget ? "text-red-600" : "text-slate-500")}>
                {u.budget > 0 ? Math.round((u.headcount / u.budget) * 100) : 0}%
              </span>
            </TD>
            <TD align="center"><Dash /></TD>
          </tr>
          {u.positions.map((p) => (
            <tr key={p.code} className="hover:bg-slate-50">
              <TD className="text-slate-600">
                <span style={{ paddingLeft: (depth + 1) * 14 + 18 }} className="inline-flex items-center gap-1.5">
                  <span className="text-slate-300">▸</span>
                  <span className="font-mono text-[8.5px] text-slate-400">{p.code}</span>
                  <span className="font-semibold">{p.title}</span>
                </span>
              </TD>
              <TD align="number">{f.num(p.filled)}</TD>
              <TD align="number">{f.num(p.headcount)}</TD>
              <TD align="center">—</TD>
              <TD align="center">
                {p.gap > 0 ? <DocBadge tone="amber">{`Lowongan ${p.gap}`}</DocBadge> : <DocBadge tone="green">Terisi</DocBadge>}
              </TD>
            </tr>
          ))}
          <UnitTreeRows nodes={u.children} depth={depth + 1} f={f} />
        </Fragment>
      ))}
    </>
  );
}

export function R13View({ data, meta }: { data: R13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r13">
      <DocHeader meta={meta} reportNo="R1.3" title="Department & Position Distribution Report" subtitle={t("Struktur Organisasi: Headcount Aktual vs Anggaran", "Org Structure: Actual vs Budgeted Headcount")} audience={t("Direksi · Manajer Departemen", "Directorate · Department Managers")} docNo={mkDocNo("r13", meta)} />

      <DocSection no="A" title={t("Ringkasan Struktur", "Structure Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Headcount Aktif", "Active Headcount"), value: f.num(data.totalActive), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Anggaran Headcount", "Headcount Budget"), value: f.num(data.totalBudget) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Slot Posisi Lowong", "Vacant Position Slots"), value: f.num(data.vacant) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Jumlah Unit Organisasi", "Org Units"), value: f.num(data.units) }]} />
      </div>

      <DocSection no="B" title={t("Hierarki Unit & Distribusi Posisi", "Unit Hierarchy & Position Distribution")} note={t("Baris berindentasi = unit anak; ▸ = posisi pada unit tersebut.", "Indented rows = child units; ▸ = positions within the unit.")} />
      <DocTable head={(
        <>
          <TH>Unit Organisasi / Posisi</TH>
          <TH align="number">{t("Terisi / HC", "Filled / HC")}</TH>
          <TH align="number">{t("Anggaran", "Budget")}</TH>
          <TH align="center">{t("Utilisasi", "Utilization")}</TH>
          <TH align="center">{t("Status Slot", "Slot Status")}</TH>
        </>
      )}>
        <UnitTreeRows nodes={data.tree} depth={0} f={f} />
      </DocTable>

      <DocFooter meta={meta} />
    </ReportSheet>
  );
}

// ================= R1.4 Employment Status =================
export function R14View({ data, meta }: { data: R14Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r14">
      <DocHeader meta={meta} reportNo="R1.4" title="Employment Status Report" subtitle={t("Tabel Tergrup Status Kepegawaian", "Grouped Employment Status Tables")} audience={t("HR · Legal · Audit Internal", "HR · Legal · Internal Audit")} docNo={mkDocNo("r14", meta)} />

      <DocSection no="A" title={t("Ringkasan Komposisi", "Composition Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Aktif", "Total Active"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Porsi Tetap", "Permanent Share"), value: f.pct(data.permanentPct) }]} />
        {data.groups.slice(0, 2).map((g) => (
          <SummaryBox key={g.status} className="grid-cols-1" items={[{ label: g.status, value: f.num(g.employees.length) }]} />
        ))}
      </div>

      {data.groups.map((g, gi) => (
        <div key={g.status}>
          <DocSection no={`B.${gi + 1}`} title={`${g.status} — ${t(`${g.employees.length} karyawan`, `${g.employees.length} employees`)}`} note={t(`L ${g.male} · P ${g.female} · rata-rata masa kerja ${g.avgTenure.toLocaleString("id-ID")} thn`, `M ${g.male} · F ${g.female} · avg tenure ${g.avgTenure} yr`)} />
          <DocTable head={(
            <>
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama Lengkap</TH><TH align="center">L/P</TH>
              <TH align="center">Tgl Masuk</TH><TH>Unit / Departemen</TH><TH>Posisi</TH><TH align="number">Masa Kerja</TH>
            </>
          )}>
            {g.employees.map((e, i) => (
              <tr key={e.employeeNo} className="hover:bg-slate-50">
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{e.name}</TD>
                <TD align="center">{e.gender === "Perempuan" ? "P" : "L"}</TD>
                <TD align="center">{f.dt(e.joinDate)}</TD>
                <TD>{e.unit ?? <Dash />}</TD>
                <TD>{e.position ?? <Dash />}</TD>
                <TD align="number">{e.tenureYears.toLocaleString("id-ID")} thn</TD>
              </tr>
            ))}
          </DocTable>
        </div>
      ))}

      <DocFooter meta={meta} signNote={t("Status kepegawaian mengacu pada penempatan aktif (EmployeeAssignment berlaku).", "Employment status refers to the active placement (effective EmployeeAssignment).")} />
    </ReportSheet>
  );
}

// ================= R1.5 Multi-branch Location Mapping =================
export function R15View({ data, meta }: { data: R15Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r15">
      <DocHeader meta={meta} reportNo="R1.5" title="Multi-branch Location Mapping Report" subtitle={t("Pemetaan Karyawan per Kantor Cabang & Lokasi Kerja", "Employee Mapping per Branch Office & Work Location")} audience={t("Manajemen · GA · Audit", "Management · GA · Audit")} docNo={mkDocNo("r15", meta)} />

      {data.offices.map((o, i) => (
        <div key={o.code}>
          <DocSection no={`A.${i + 1}`} title={`${o.name}${o.active ? "" : " (Nonaktif)"}`} note={[o.address, o.city].filter(Boolean).join(", ") || undefined} />
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200">
              <div className="grid grid-cols-2 divide-x divide-slate-200">
                <div className="bg-slate-50 px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{t("Headcount", "Headcount")}</p><p className="text-lg font-black text-slate-900">{f.num(o.headcount)}</p></div>
                <div className="bg-slate-50 px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">L / P</p><p className="text-lg font-black text-slate-900">{o.male} / {o.female}</p></div>
              </div>
              <div className="space-y-1 border-t border-slate-200 px-3 py-2 text-[9.5px] text-slate-600">
                <p><span className="font-bold">{t("Kode", "Code")}:</span> <span className="font-mono">{o.code}</span></p>
                <p><span className="font-bold">{t("Telepon", "Phone")}:</span> {o.phone ?? <Dash />}</p>
                <p><span className="font-bold">NPWP:</span> {o.npwp ?? <Dash />}</p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 lg:col-span-2">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">{t("Komposisi Status Kepegawaian", "Employment Status Mix")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {o.statusMix.length === 0 && <span className="text-[10px] text-slate-400">{t("Tidak ada karyawan", "No employees")}</span>}
                {o.statusMix.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[9.5px] font-bold text-slate-700">
                    <span className={cn("h-1.5 w-1.5 rounded-full", s.label === "Permanent" ? "bg-emerald-500" : s.label === "Contract" ? "bg-sky-500" : s.label === "Probation" ? "bg-amber-500" : "bg-violet-500")} />
                    {s.label} · {s.count}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[9px] font-extrabold uppercase tracking-wider text-slate-500">{t("Lokasi Kerja (Site/Plant)", "Work Locations (Site/Plant)")}</p>
              <div className="mt-1.5 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2">
                {o.workLocations.length === 0 && <p className="bg-white px-2.5 py-1.5 text-[9.5px] text-slate-400">—</p>}
                {o.workLocations.map((l) => (
                  <div key={l.code} className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5">
                    <span className="text-[9.5px] font-semibold text-slate-700"><span className="font-mono text-slate-400">{l.code}</span> {l.name}</span>
                    <span className="text-[9.5px] font-black tabular-nums text-slate-800">{f.num(l.headcount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      <DocSection no="B" title={t("Rekapitulasi", "Recap")} />
      <DocTable head={<><TH>Kantor</TH><TH align="number">Laki-laki</TH><TH align="number">Perempuan</TH><TH align="number">Total</TH></>}>
        {data.offices.map((o) => (
          <tr key={o.code} className="hover:bg-slate-50">
            <TD className="font-semibold">{o.name}</TD>
            <TD align="number">{f.num(o.male)}</TD>
            <TD align="number">{f.num(o.female)}</TD>
            <TD align="number">{f.num(o.headcount)}</TD>
          </tr>
        ))}
        <TotalRow label={t("Total", "Total")} cells={[data.offices.reduce((s, o) => s + o.male, 0), data.offices.reduce((s, o) => s + o.female, 0), data.total]} />
      </DocTable>

      <DocFooter meta={meta} />
    </ReportSheet>
  );
}

// ================= R2.1 Contract Expiry Alert =================
const URGENCY_STYLE: Record<string, { tone: "red" | "rose" | "amber" | "sky" | "green" | "slate"; label: string; en: string; row?: string }> = {
  overdue: { tone: "red", label: "Lewat Jatuh Tempo", en: "Overdue", row: "bg-red-50/70" },
  critical: { tone: "rose", label: "Kritis", en: "Critical (<30d)", row: "bg-rose-50/60" },
  warning: { tone: "amber", label: "Perhatian", en: "Warning (<60d)" },
  caution: { tone: "sky", label: "Waspada", en: "Caution (<90d)" },
  safe: { tone: "green", label: "Aman", en: "Safe (>90d)" },
};

export function R21View({ data, meta }: { data: R21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="r21">
      <DocHeader meta={meta} reportNo="R2.1" title="Contract Expiry Alert Report — PKWT" subtitle={t("Pemantauan Jatuh Tempo Perjanjian Kerja Waktu Tertentu", "Fixed-Term Contract Expiry Monitoring")} audience={t("HR · Atasan Langsung · Legal", "HR · Line Managers · Legal")} docNo={mkDocNo("r21", meta)} />

      <DocSection no="A" title={t("Legenda Urgensi", "Urgency Legend")} note={t("Kritis < 30 hari · Perhatian < 60 hari · Waspada < 90 hari · aman di atas 90 hari.", "Critical < 30 days · Warning < 60 days · Caution < 90 days · safe beyond 90 days.")} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {data.counts.map((c) => {
          const st = URGENCY_STYLE[c.urgency];
          return (
            <div key={c.urgency} className={cn("rounded-lg border px-3 py-2", st.row ?? "border-slate-200 bg-slate-50")}>
              <div className="flex items-center justify-between gap-1">
                <DocBadge tone={st.tone}>{t(st.label, st.en)}</DocBadge>
                <span className="text-base font-black tabular-nums text-slate-900">{c.count}</span>
              </div>
              <p className="mt-1 text-[8.5px] font-bold text-slate-400">{c.count > 0 ? t("kontrak", "contracts") : t("tidak ada", "none")}</p>
            </div>
          );
        })}
      </div>

      <DocSection no="B" title={t("Daftar Kontrak (urut sisa hari)", "Contract List (by days remaining)")} />
      <DocTable head={(
        <>
          <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Posisi</TH>
          <TH align="center">Mulai</TH><TH align="center">Berakhir</TH><TH align="number">Sisa Hari</TH>
          <TH align="center">Urgensi</TH><TH align="center">Perpanjangan ke-</TH>
        </>
      )}>
        {data.items.map((it, i) => {
          const st = URGENCY_STYLE[it.urgency];
          return (
            <tr key={it.employeeNo} className={cn("hover:bg-slate-50", st.row)}>
              <TD align="center" className="text-slate-400">{i + 1}</TD>
              <TD className="font-bold text-slate-800">{it.employeeNo}</TD>
              <TD className="font-semibold text-slate-800">{it.name}</TD>
              <TD>{it.unit ?? <Dash />}</TD>
              <TD>{it.position ?? <Dash />}</TD>
              <TD align="center">{f.dt(it.contractStart)}</TD>
              <TD align="center" className="font-bold">{f.dt(it.contractEnd)}</TD>
              <TD align="number" className={cn("font-black", it.daysRemaining < 30 ? (it.daysRemaining < 0 ? "text-red-600" : "text-rose-600") : "text-slate-700")}>
                {it.daysRemaining < 0 ? `${it.daysRemaining}` : it.daysRemaining}
              </TD>
              <TD align="center"><DocBadge tone={st.tone}>{t(st.label, st.en)}</DocBadge></TD>
              <TD align="center">{it.renewalCount}</TD>
            </tr>
          );
        })}
        <TotalRow label={t("Total kontrak terpantau", "Total monitored contracts")} cells={[data.total]} />
      </DocTable>

      <DocSection no="C" title={t("Tindak Lanjut yang Disarankan", "Recommended Actions")} />
      <ol className="ml-4 list-decimal space-y-1 text-[10px] leading-relaxed text-slate-700">
        <li>{t("Lewat Jatuh Tempo / Kritis: segera terbitkan keputusan perpanjangan atau akhir kontrak minimal 14 hari sebelum tanggal berakhir (PP 35/2021 Pasal 14–15).", "Overdue / Critical: issue a renewal or termination decision at least 14 days before expiry (GR 35/2021 Art. 14–15).")}</li>
        <li>{t("Perhatian: verifikasi kebutuhan posisi & anggaran bersama atasan langsung.", "Warning: verify position need & budget with the line manager.")}</li>
        <li>{t("Perhatikan batas perpanjangan PKWT — kontrak berbasis jangka waktu maksimal 5 tahun keseluruhan (putusan MK 168/PUU-XXI/2023).", "Mind cumulative PKWT term limits — time-based contracts cap at 5 cumulative years (Constitutional Court ruling 168/PUU-XXI/2023).")}</li>
      </ol>

      <DocFooter meta={meta} signNote={t("Laporan aksi — distribusi ke atasan langsung paling lambat H-30 sebelum jatuh tempo.", "Action report — distribute to line managers no later than D-30 before expiry.")} />
    </ReportSheet>
  );
}

// ================= R2.2 Tenure Summary =================
export function R22View({ data, meta }: { data: R22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const max = Math.max(1, ...data.buckets.map((b) => b.count));
  return (
    <ReportSheet docId="r22">
      <DocHeader meta={meta} reportNo="R2.2" title="Employee Tenure Summary Report" subtitle={t("Masa Kerja untuk Program Penghargaan (Service Award)", "Tenure for Recognition Programs (Service Award)")} audience={t("HR · Direksi (Service Award)", "HR · Directorate (Service Award)")} docNo={mkDocNo("r22", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Aktif", "Active Employees"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Masa Kerja", "Average Tenure"), value: `${data.avgTenure.toLocaleString("id-ID")} thn` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Layak Service Award (≥5 thn)", "Service-Award Eligible (≥5 yr)"), value: f.num(data.eligible5yr) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Masa Kerja Terpanjang", "Longest Tenure"), value: data.longest ? `${data.longest.tenureYears.toLocaleString("id-ID")} thn` : <Dash /> }]} />
      </div>

      <DocSection no="B" title={t("Distribusi Bracket Masa Kerja", "Tenure Bracket Distribution")} />
      <DocTable head={<><TH>Bracket Masa Kerja</TH><TH align="number">Jumlah</TH><TH align="number">Persentase</TH><TH>{t("Sebaran", "Spread")}</TH></>}>
        {data.buckets.map((b) => (
          <tr key={b.key} className="hover:bg-slate-50">
            <TD className="font-semibold text-slate-800">{b.label}</TD>
            <TD align="number" className="font-black">{f.num(b.count)}</TD>
            <TD align="number">{f.pct(b.pct)}</TD>
            <TD>
              <div className="h-2.5 min-w-[120px] overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-700" style={{ width: `${Math.max(3, (b.count / max) * 100)}%` }} />
              </div>
            </TD>
          </tr>
        ))}
        <TotalRow label={t("Total", "Total")} cells={[data.total, "100%", ""]} />
      </DocTable>

      <DocSection no="C" title={t("Daftar Long Service (≥ 5 tahun) — Kandidat Penghargaan", "Long-Service List (≥ 5 years) — Recognition Candidates")} note={t("Diurutkan dari masa kerja terpanjang.", "Sorted by longest tenure first.")} />
      <DocTable head={(
        <>
          <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH align="center">Tgl Masuk</TH>
          <TH align="number">Masa Kerja</TH><TH align="center">Ambang Pencapaian</TH><TH>Unit</TH><TH>Posisi</TH>
        </>
      )}>
        {data.longService.length === 0 && (
          <tr><TD colSpan={8} align="center" className="py-6 text-slate-400">{t("Belum ada karyawan dengan masa kerja ≥ 5 tahun.", "No employees with ≥ 5-year tenure yet.")}</TD></tr>
        )}
        {data.longService.map((e, i) => {
          const milestone = e.tenureYears >= 25 ? 25 : e.tenureYears >= 20 ? 20 : e.tenureYears >= 15 ? 15 : e.tenureYears >= 10 ? 10 : 5;
          return (
            <tr key={e.employeeNo} className="hover:bg-slate-50">
              <TD align="center" className="text-slate-400">{i + 1}</TD>
              <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
              <TD className="font-semibold text-slate-800">{e.name}</TD>
              <TD align="center">{f.dt(e.joinDate)}</TD>
              <TD align="number" className="font-black">{e.tenureYears.toLocaleString("id-ID")} thn</TD>
              <TD align="center"><DocBadge tone={milestone >= 20 ? "violet" : milestone >= 10 ? "green" : "sky"}>{milestone} thn</DocBadge></TD>
              <TD>{e.unit ?? <Dash />}</TD>
              <TD>{e.position ?? <Dash />}</TD>
            </tr>
          );
        })}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Ambang 5/10/15/20/25 tahun dipakai sebagai skala penghargaan masa kerja perusahaan.", "5/10/15/20/25-year thresholds are used as the company service-award scale.")} />
    </ReportSheet>
  );
}

// ================= R2.3 Probation Evaluation Schedule =================
export function R23View({ data, meta }: { data: R23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const tone = { overdue: "red", "due-soon": "amber", scheduled: "sky" } as const;
  const label = { overdue: t("Terlambat Dinilai", "Overdue"), "due-soon": t("Segera (<14 hr)", "Due Soon (<14d)"), scheduled: t("Terjadwal", "Scheduled") } as const;
  return (
    <ReportSheet docId="r23">
      <DocHeader meta={meta} reportNo="R2.3" title="Probation Evaluation Schedule" subtitle={t("Jadwal Tinjauan Masa Percobaan — maks. 3 bulan (PP 35/2021)", "Probation Review Timeline — max 3 months (GR 35/2021)")} audience={t("Atasan Langsung · HR", "Line Managers · HR")} docNo={mkDocNo("r23", meta)} />

      <DocSection no="A" title={t("Ringkasan Jadwal", "Schedule Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan Probation", "Probation Employees"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terlambat", "Overdue"), value: f.num(data.overdue) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Segera (<14 hr)", "Due Soon (<14d)"), value: f.num(data.dueSoon) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terjadwal", "Scheduled"), value: f.num(data.scheduled) }]} />
      </div>

      <DocSection no="B" title={t("Timeline Evaluasi (urut jatuh tempo)", "Evaluation Timeline (by due date)")} note={t("Atasan langsung mengisi formulir penilaian sebelum tanggal jatuh tempo; HR merekomendasikan pass/fail minimal H-7.", "Line managers complete the evaluation form before the due date; HR recommends pass/fail at least D-7.")} />
      <div className="space-y-2.5">
        {data.items.length === 0 && (
          <div className="rounded-lg border border-slate-200 py-6 text-center text-[11px] text-slate-400">{t("Tidak ada karyawan dalam masa percobaan.", "No employees currently on probation.")}</div>
        )}
        {data.items.map((it, i) => (
          <div key={it.employeeNo} className={cn("rounded-lg border border-slate-200 p-3", it.status === "overdue" && "border-red-200 bg-red-50/50", it.status === "due-soon" && "border-amber-200 bg-amber-50/40")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold text-slate-900">
                  <span className="mr-1.5 font-mono text-[9px] text-slate-400">#{i + 1}</span>
                  {it.name} <span className="font-mono text-[9px] font-bold text-slate-400">{it.employeeNo}</span>
                </p>
                <p className="mt-0.5 text-[9.5px] text-slate-500">{it.position ?? "—"} · {it.unit ?? "—"} · {t("Atasan", "Reports to")}: {it.manager ?? "—"}</p>
              </div>
              <DocBadge tone={tone[it.status]}>{label[it.status]}</DocBadge>
            </div>
            <div className="mt-2.5 grid grid-cols-3 items-center gap-2 text-center">
              <div className="rounded-md bg-slate-100 px-2 py-1.5">
                <p className="text-[7.5px] font-bold uppercase tracking-wider text-slate-400">{t("Tgl Masuk", "Join Date")}</p>
                <p className="text-[10px] font-black text-slate-800">{f.dt(it.joinDate)}</p>
              </div>
              <div className="flex items-center gap-1 px-1">
                <div className="h-px flex-1 border-t-2 border-dotted border-slate-300" />
                <span className="whitespace-nowrap text-[8px] font-bold text-slate-400">{t("3 bulan", "3 months")}</span>
                <div className="h-px flex-1 border-t-2 border-dotted border-slate-300" />
              </div>
              <div className={cn("rounded-md px-2 py-1.5", it.status === "overdue" ? "bg-red-100" : "bg-slate-800")}>
                <p className={cn("text-[7.5px] font-bold uppercase tracking-wider", it.status === "overdue" ? "text-red-500" : "text-slate-300")}>{t("Jatuh Tempo Evaluasi", "Evaluation Due")}</p>
                <p className={cn("text-[10px] font-black", it.status === "overdue" ? "text-red-700" : "text-white")}>{f.dt(it.evalDue)}</p>
              </div>
            </div>
            <p className="mt-2 text-[9px] font-bold text-slate-500">
              {it.daysRemaining < 0
                ? t(`Terlambat ${Math.abs(it.daysRemaining)} hari — segera ajukan hasil penilaian ke HR.`, `Overdue by ${Math.abs(it.daysRemaining)} days — submit the evaluation result to HR immediately.`)
                : t(`Sisa ${it.daysRemaining} hari untuk menyelesaikan penilaian.`, `${it.daysRemaining} days remaining to complete the evaluation.`)}
            </p>
          </div>
        ))}
      </div>

      <DocFooter meta={meta} signNote={t("Masa percobaan maksimal 3 bulan sebagaimana diatur PP 35/2021 Pasal 10; hasil dituangkan dalam Personnel Action.", "Probation is capped at 3 months per GR 35/2021 Art. 10; the outcome is recorded via a Personnel Action.")} />
    </ReportSheet>
  );
}
