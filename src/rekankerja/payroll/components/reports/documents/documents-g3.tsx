"use client";
// RekanKerja Payroll — GRUP 3: IURAN WAJIB PEMERINTAH ========================
// R3.1 BPJS Ketenagakerjaan (JHT/JKK/JKM/JP — porsi perusahaan vs karyawan)
// R3.2 BPJS Kesehatan (4% perusahaan / 1% karyawan + plafon)
// R3.3 Tapera (2,5% perusahaan / 0,5% karyawan — PP 21/2024).
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocMeta } from "../params";
import {
  PrintDoc, DocHeader, useStandardMeta, DocSection, TotalBand, SignOff, Confidentiality,
  money, num, docPlace, EmptyDocRow,
} from "../doc-kit";

interface BpjsRow {
  employeeNo: string; employeeName: string; orgUnitName: string;
  nik: string | null; bpjsKes: string | null;
  jhtCompany: number | null; jhtEmployee: number | null;
  jpCompany: number | null; jpEmployee: number | null;
  jkk: number | null; jkm: number | null;
  jknCompany: number | null; jknEmployee: number | null; jknBasis: number | null;
}

// ================== R3.1 — BPJS KETENAGAKERJAAN =============================

interface BpjsTkPayload extends DocMeta {
  rows: BpjsRow[];
  totals: {
    employees: number; jhtCompany: number | null; jhtEmployee: number | null;
    jpCompany: number | null; jpEmployee: number | null; jkk: number | null; jkm: number | null;
    jknCompany: number | null; jknEmployee: number | null;
  };
  regulation: {
    jhtCompanyRate: number; jhtEmployeeRate: number; jpCompanyRate: number; jpEmployeeRate: number;
    jkkRate: number; jkmRate: number; jpSalaryCap: number;
  } | null;
}

const pctLabel = (v: number | undefined) => (v == null ? "—" : `${v * 100}`.replace(".", ",").replace(/,0$/, "") + "%");

export function BpjsTkDoc({ data }: { data: BpjsTkPayload }) {
  const { t } = useI18n();
  const reg = data.regulation;
  const sumCompany = (r: BpjsRow) => (r.jhtCompany ?? 0) + (r.jpCompany ?? 0) + (r.jkk ?? 0) + (r.jkm ?? 0);
  const sumEmployee = (r: BpjsRow) => (r.jhtEmployee ?? 0) + (r.jpEmployee ?? 0);
  const meta = useStandardMeta(data, [
    { label: t("Program", "Program"), value: "JHT · JP · JKK · JKM" },
    { label: t("Dasar Hukum", "Legal Basis"), value: "UU 24/2011" },
  ]);

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Laporan Iuran BPJS Ketenagakerjaan", "BPJS Ketenagakerjaan Premium Sheet")}
        subtitle={`${data.run?.runNo ?? "—"} · ${data.run?.periodName ?? ""}`}
        reportNo="R3.1"
        meta={meta}
      />
      <DocSection
        title={t("Rincian Iuran per Karyawan — Porsi Perusahaan (Company Borne) vs Porsi Karyawan (Employee Deduction)", "Premium Detail per Employee — Company-Borne Portion vs Employee Deduction Portion")}
        note={t(
          "Tarif UU 24/2011: JHT {jhtC} perusahaan / {jhtE} karyawan · JP {jpC} / {jpE} (plafon upah {cap}) · JKK {jkk} (kelas risiko) · JKM {jkm}. Iuran porsi perusahaan dibayar DI LUAR take home pay; porsi karyawan dipotong dari gaji.",
          "Rates per Law 24/2011: JHT {jhtC} employer / {jhtE} employee · JP {jpC} / {jpE} (wage cap {cap}) · JKK {jkk} (risk class) · JKM {jkm}. Company-borne premiums are paid OUTSIDE take-home pay; the employee portion is deducted from salary.",
          {
            jhtC: pctLabel(reg?.jhtCompanyRate), jhtE: pctLabel(reg?.jhtEmployeeRate),
            jpC: pctLabel(reg?.jpCompanyRate), jpE: pctLabel(reg?.jpEmployeeRate),
            cap: money(reg?.jpSalaryCap ?? null), jkk: pctLabel(reg?.jkkRate), jkm: pctLabel(reg?.jkmRate),
          },
        )}
      >
        <div className="rk-doc-table overflow-x-auto"><table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr>
              <th colSpan={5} className="border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" />
              <th colSpan={4} className="border border-slate-700 bg-emerald-800 px-1.5 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-white">
                {t("Porsi Perusahaan (Company Borne)", "Company-Borne Portion")}
              </th>
              <th colSpan={2} className="border border-slate-700 bg-rose-800 px-1.5 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-white">
                {t("Porsi Karyawan (Employee Deduction)", "Employee Deduction Portion")}
              </th>
              <th colSpan={1} className="border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" />
            </tr>
            <tr className="bg-slate-700 text-white">
              <th className="w-8 border border-slate-600 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("No", "No.")}</th>
              <th className="w-[20mm] border border-slate-600 px-1.5 py-1 text-left text-[9px] font-bold uppercase">NIK</th>
              <th className="border border-slate-600 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-600 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Nama", "Name")}</th>
              <th className="border border-slate-600 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-600 px-1.5 py-1 text-right text-[9px] font-bold uppercase">JHT {pctLabel(reg?.jhtCompanyRate)}</th>
              <th className="border border-slate-600 px-1.5 py-1 text-right text-[9px] font-bold uppercase">JP {pctLabel(reg?.jpCompanyRate)}</th>
              <th className="border border-slate-600 px-1.5 py-1 text-right text-[9px] font-bold uppercase">JKK</th>
              <th className="border border-slate-600 px-1.5 py-1 text-right text-[9px] font-bold uppercase">JKM</th>
              <th className="border border-slate-600 px-1.5 py-1 text-right text-[9px] font-bold uppercase">JHT {pctLabel(reg?.jhtEmployeeRate)}</th>
              <th className="border border-slate-600 px-1.5 py-1 text-right text-[9px] font-bold uppercase">JP {pctLabel(reg?.jpEmployeeRate)}</th>
              <th className="border border-slate-600 bg-slate-900 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Total", "Total")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyDocRow colSpan={12} message={t("Tidak ada baris iuran pada run ini.", "No premium rows in this run.")} />}
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 font-mono text-[9.5px]">{r.nik ?? "—"}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{r.employeeNo}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5 font-semibold">{r.employeeName}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.orgUnitName}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jhtCompany)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jpCompany)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jkk)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jkm)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jhtEmployee)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jpEmployee)}</td>
                <td className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-right font-bold tabular-nums">{money(sumCompany(r) + sumEmployee(r))}</td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={5} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total ({n} karyawan)", "Total ({n} employees)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jhtCompany)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jpCompany)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jkk)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jkm)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jhtEmployee)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jpEmployee)}</td>
              <td className="border border-slate-400 bg-slate-300 px-1.5 py-1 text-right font-extrabold tabular-nums">
                {money(
                  (data.totals.jhtCompany ?? 0) + (data.totals.jpCompany ?? 0) + (data.totals.jkk ?? 0) +
                  (data.totals.jkm ?? 0) + (data.totals.jhtEmployee ?? 0) + (data.totals.jpEmployee ?? 0),
                )}
              </td>
            </tr>
          </tbody>
        </table></div>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Porsi Perusahaan (JHT+JP+JKK+JKM)", "Total Company Portion (JHT+JP+JKK+JKM)"), value: money((data.totals.jhtCompany ?? 0) + (data.totals.jpCompany ?? 0) + (data.totals.jkk ?? 0) + (data.totals.jkm ?? 0)), tone: "green" },
          { label: t("Total Porsi Karyawan (JHT+JP)", "Total Employee Portion (JHT+JP)"), value: money((data.totals.jhtEmployee ?? 0) + (data.totals.jpEmployee ?? 0)), tone: "red" },
          { label: t("Plafon Upah JP", "JP Wage Cap"), value: money(reg?.jpSalaryCap ?? null), tone: "dark" },
          { label: t("Jumlah Peserta", "Participants"), value: `${data.totals.employees} ${t("orang", "persons")}`, tone: "dark" },
        ]}
      />

      <SignOff place={docPlace(data.company?.city, data.officer.printedAt)} preparedBy={data.officer.name} />
      <Confidentiality />
    </PrintDoc>
  );
}

// ================== R3.2 — BPJS KESEHATAN ===================================

interface BpjsKesPayload extends DocMeta {
  rows: (BpjsRow & { upah: number | null })[];
  totals: { employees: number; jknCompany: number | null; jknEmployee: number | null };
  regulation: { jpkCompanyRate: number; jpkEmployeeRate: number; jpkSalaryCap: number } | null;
}

export function BpjsKesehatanDoc({ data }: { data: BpjsKesPayload }) {
  const { t } = useI18n();
  const reg = data.regulation;
  const meta = useStandardMeta(data, [
    { label: t("Program", "Program"), value: "JKN — BPJS Kesehatan" },
    { label: t("Dasar Hukum", "Legal Basis"), value: "Perpes BPJS Kesehatan" },
  ]);

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Laporan Iuran BPJS Kesehatan (JKN)", "BPJS Kesehatan (JKN) Premium Sheet")}
        subtitle={`${data.run?.runNo ?? "—"} · ${data.run?.periodName ?? ""}`}
        reportNo="R3.2"
        meta={meta}
      />
      <DocSection
        title={t("Kalkulasi Iuran 4% Perusahaan dan 1% Karyawan", "4% Company and 1% Employee Premium Calculation")}
        note={t(
          "Iuran JKN dihitung dari upah (gaji pokok + tunjangan tetap) dengan batas atas (plafon) {cap} sesuai ketentuan pemerintah yang berlaku. Porsi perusahaan {pc} dibayar di luar THP; porsi karyawan {pe} dipotong dari gaji.",
          "JKN premiums are computed on wages (basic salary + fixed allowances) capped at {cap} per current government regulation. The company portion {pc} is paid outside THP; the employee portion {pe} is deducted from salary.",
          { cap: money(reg?.jpkSalaryCap ?? null), pc: pctLabel(reg?.jpkCompanyRate), pe: pctLabel(reg?.jpkEmployeeRate) },
        )}
      >
        <div className="rk-doc-table overflow-x-auto"><table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("No", "No.")}</th>
              <th className="w-[20mm] border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">NIK</th>
              <th className="w-[20mm] border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("No. Kartu", "Card No.")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Nama Peserta", "Participant Name")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Upah (Basis Iuran)", "Wage (Premium Basis)")}</th>
              <th className="border border-slate-700 bg-emerald-800 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Perusahaan {p}", "Company {p}", { p: pctLabel(reg?.jpkCompanyRate) })}</th>
              <th className="border border-slate-700 bg-rose-800 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Karyawan {p}", "Employee {p}", { p: pctLabel(reg?.jpkEmployeeRate) })}</th>
              <th className="border border-slate-700 bg-slate-900 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Total Iuran", "Total Premium")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyDocRow colSpan={9} message={t("Tidak ada peserta JKN pada run ini.", "No JKN participants in this run.")} />}
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 font-mono text-[9.5px]">{r.nik ?? "—"}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center font-mono text-[9.5px]">{r.bpjsKes ?? "—"}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5 font-semibold">{r.employeeName}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.orgUnitName}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.upah)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jknCompany)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.jknEmployee)}</td>
                <td className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-right font-bold tabular-nums">{money((r.jknCompany ?? 0) + (r.jknEmployee ?? 0))}</td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={6} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total ({n} peserta)", "Total ({n} participants)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jknCompany)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.jknEmployee)}</td>
              <td className="border border-slate-400 bg-slate-300 px-1.5 py-1 text-right font-extrabold tabular-nums">{money((data.totals.jknCompany ?? 0) + (data.totals.jknEmployee ?? 0))}</td>
            </tr>
          </tbody>
        </table></div>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Iuran Perusahaan (4%)", "Total Company Premium (4%)"), value: money(data.totals.jknCompany), tone: "green" },
          { label: t("Total Iuran Karyawan (1%)", "Total Employee Premium (1%)"), value: money(data.totals.jknEmployee), tone: "red" },
          { label: t("Plafon Upah Berlaku", "Current Wage Cap"), value: money(reg?.jpkSalaryCap ?? null), tone: "dark" },
          { label: t("Jumlah Peserta", "Participants"), value: `${data.totals.employees} ${t("orang", "persons")}`, tone: "dark" },
        ]}
      />

      <SignOff place={docPlace(data.company?.city, data.officer.printedAt)} preparedBy={data.officer.name} />
      <Confidentiality />
    </PrintDoc>
  );
}

// ================== R3.3 — TAPERA ==========================================

interface TaperaPayload extends DocMeta {
  rows: { employeeNo: string; employeeName: string; orgUnitName: string; companyPart: number | null; employeePart: number | null }[];
  totals: { employees: number; totalCompany: number | null; totalEmployee: number | null };
}

export function TaperaDoc({ data }: { data: TaperaPayload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Program", "Program"), value: "BP Tapera" },
    { label: t("Tarif", "Rate"), value: t("2,5% perusahaan + 0,5% karyawan", "2.5% company + 0.5% employee") },
    { label: t("Dasar Hukum", "Legal Basis"), value: "PP 21/2024" },
  ]);

  return (
    <PrintDoc orientation="portrait">
      <DocHeader
        company={data.company}
        title={t("Laporan Iuran Tapera (Tabungan Perumahan Rakyat)", "Tapera (People's Housing Savings) Premium Sheet")}
        subtitle={`${data.run?.runNo ?? "—"} · ${data.run?.periodName ?? ""}`}
        reportNo="R3.3"
        meta={meta}
      />
      <DocSection
        title={t("Rincian Iuran Tapera per Karyawan", "Tapera Premium Detail per Employee")}
        note={t(
          "PP 21/2024: iuran Tapera 3% dari upah bulanan — 2,5% ditanggung pemberi kerja dan 0,5% dipotong dari karyawan. Kewajiban sektor swasta mulai berlaku bertahap (dari 2027); BUMN lebih dulu (2026). Bila perusahaan Anda belum aktif, laporan ini akan kosong — aktifkan dengan menambahkan komponen upah TAPERA (porsi _C untuk perusahaan, potongan untuk karyawan).",
          "PP 21/2024: Tapera premium is 3% of monthly wages — 2.5% borne by the employer and 0.5% deducted from the employee. The private-sector obligation phases in (from 2027); state-owned enterprises first (2026). If your company is not yet enrolled, this report will be empty — activate it by adding TAPERA wage components (_C code for company, deduction for employee).",
        )}
      >
        <div className="rk-doc-table overflow-x-auto"><table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("No", "No.")}</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Nama", "Name")}</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-700 bg-emerald-800 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Porsi Perusahaan (2,5%)", "Company Portion (2.5%)")}</th>
              <th className="border border-slate-700 bg-rose-800 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Porsi Karyawan (0,5%)", "Employee Portion (0.5%)")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Total (3%)", "Total (3%)")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <EmptyDocRow
                colSpan={7}
                message={t(
                  "Belum ada iuran Tapera yang dihitung pada run ini — program belum aktif untuk perusahaan ini (lihat catatan regulasi di bawah tabel).",
                  "No Tapera premiums computed in this run — the program is not yet active for this company (see the regulatory note below the table).",
                )}
              />
            )}
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-2 py-0.5 font-mono">{r.employeeNo}</td>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-0.5 font-semibold">{r.employeeName}</td>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-0.5">{r.orgUnitName}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.companyPart)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.employeePart)}</td>
                <td className="border border-slate-300 bg-slate-100 px-2 py-0.5 text-right font-bold tabular-nums">{money((r.companyPart ?? 0) + (r.employeePart ?? 0))}</td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={4} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total ({n} karyawan)", "Total ({n} employees)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalCompany)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalEmployee)}</td>
              <td className="border border-slate-400 bg-slate-300 px-2 py-1 text-right font-extrabold tabular-nums">{money((data.totals.totalCompany ?? 0) + (data.totals.totalEmployee ?? 0))}</td>
            </tr>
          </tbody>
        </table></div>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Porsi Perusahaan", "Total Company Portion"), value: money(data.totals.totalCompany), tone: "green" },
          { label: t("Total Porsi Karyawan", "Total Employee Portion"), value: money(data.totals.totalEmployee), tone: "red" },
          { label: t("Jumlah Peserta", "Participants"), value: `${data.totals.employees} ${t("orang", "persons")}`, tone: "dark" },
          { label: t("Status Program", "Program Status"), value: data.rows.length ? t("Aktif", "Active") : t("Belum Berlaku", "Not Yet Active"), tone: "dark" },
        ]}
      />

      <SignOff place={docPlace(data.company?.city, data.officer.printedAt)} preparedBy={data.officer.name} />
      <Confidentiality />
    </PrintDoc>
  );
}

// re-export util num (dipakai dokumen lain bila perlu)
export { num as _num };
