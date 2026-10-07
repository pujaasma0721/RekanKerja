"use client";
// ============================================================================
// RekanKerja Payroll — R2.2 BUKTI POTONG PPh PASAL 21 BAGI PEGAWAI TETAP =====
// Formulir DJP 1721-A1 — layout siap cetak A4 portrait =======================
// ============================================================================
// STRUKTUR (mengikuti kerangka resmi DJP — PER-21/PJ/2009 jo. PMK 34/2021):
//   Kop     : judul formulir + NOMOR + MASA/TAHUN PAJAK
//   Bag. A  : Identitas Penerima Penghasilan (NPWP, NIK, Nama, Alamat,
//             Status karyawan, Status kawin, Jumlah PT)
//   Bag. B  : Rincian Penghasilan & Penghitungan PPh 21 (baris 1-18):
//             1 Gaji/Pensiun · 2 Tunjangan PPh · 3 Tunjangan lainnya, uang
//             lembur dsb · 4 Premi asuransi dibayar pemberi kerja · 5 Tantiem/
//             bonus/THR · 6 Bruto · 7 Biaya jabatan · 8 Iuran pensiun/THT/JHT
//             · 9 Jumlah pengurang · 10 Neto · 11 Neto masa sebelumnya ·
//             12 Neto setahun · 13 PTKP (a-d) · 14 PKP · 15 PPh21 terutang
//             setahun · 16 telah dipotong masa sebelumnya · 17 terutang masa
//             pajak terakhir · 18 kurang/(lebih) bayar.
//   Bag. C  : Identitas Pemotong (perusahaan) + area tanda tangan.
//
// TEMPLATE BINDING (padanan handlebars — backend menyuntik data via props):
//   {{npwp}}              ← employee.npwp            {{nik}} ← employee.nik
//   {{employee_name}}     ← employee.employeeName    {{address}} ← employee.address
//   {{ptkp_status}}       ← employee.taxStatus       {{dependents}} ← jumlah PT
//   {{gross_income}}      ← baris 1-5 / 6 (bruto setahun)
//   {{pph21_terutang}}    ← baris 15 (PPh 21 Pasal 17 setahun)
//   {{company_name}} / {{company_npwp}} / {{company_address}} ← Bag. C
// ============================================================================
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocMeta } from "../params";
import { PrintDoc, Confidentiality, money } from "../doc-kit";

export interface SptEmp {
  employeeNo: string; employeeName: string; orgUnitName: string | null; positionName: string | null;
  npwp: string | null; nik?: string | null; gender?: string | null; address?: string | null;
  taxStatus: string; ptkpAnnual: number; hasNpwp: boolean;
  gajiPokok: number; tunjanganPph: number; tunjanganLain: number; premiAsuransi: number;
  tantiemThr: number; biayaJabatan: number; iuranPensiun: number;
  neto: number; pkp: number; pph21Annual: number; taxWithheld: number; delta: number;
  monthFirst: number; monthLast: number; lastMonthBruto: number; lastMonthTax: number;
  priorNeto: number; priorTax: number;
}

export interface BuktiPotongPayload extends DocMeta {
  year: number;
  formNo: string;
  employee: SptEmp;
}

const PTKP_DIRI = 54_000_000;
const PTKP_KAWIN = 4_500_000;
const PTKP_TANGGUNGAN = 4_500_000;

const numRp = (v: number | null | undefined): string =>
  v == null ? "—" : `Rp ${new Intl.NumberFormat("id-ID").format(v)}`;

/** Baris terstruktur Bagian B: nomor — label — nilai. */
function FormRow({ no, label, value, strong, sub, blank }: {
  no: string; label: string; value?: string; strong?: boolean; sub?: boolean; blank?: boolean;
}) {
  return (
    <tr className={cn(strong && "bg-slate-100 font-bold", sub && "text-[10.5px]")}>
      <td className="w-7 border border-slate-400 px-1 py-[3px] text-center align-top text-[10.5px] font-bold tabular-nums">
        {no}
      </td>
      <td className={cn("border border-slate-400 px-2 py-[3px] leading-snug", sub && "pl-6")}>{label}</td>
      <td className={cn(
        "w-[52mm] border border-slate-400 px-2 py-[3px] text-right align-top tabular-nums",
        blank ? "bg-slate-50" : "font-semibold",
      )}>
        {value ?? ""}
      </td>
    </tr>
  );
}

export function BuktiPotongA1Doc({ data }: { data: BuktiPotongPayload }) {
  const { t } = useI18n();
  const e = data.employee;
  const ptkpMatch = /^(TK|K|KI)(\d)/.exec(e.taxStatus ?? "");
  const isKawin = ptkpMatch ? ptkpMatch[1] !== "TK" : false;
  const isGabung = ptkpMatch ? ptkpMatch[1] === "KI" : false;
  const dependents = ptkpMatch ? Math.min(3, parseInt(ptkpMatch[2], 10)) : 0;

  const r1 = e.gajiPokok, r2 = e.tunjanganPph, r3 = e.tunjanganLain, r4 = e.premiAsuransi, r5 = e.tantiemThr;
  const r6 = r1 + r2 + r3 + r4 + r5;
  const r7 = e.biayaJabatan, r8 = e.iuranPensiun;
  const r9 = r7 + r8;
  const r10 = r6 - r9;
  const r11 = e.priorNeto;
  const r12 = r10 + r11;
  const r13 = e.ptkpAnnual;
  const r14 = e.pkp;
  const r15 = e.pph21Annual;
  const r16 = e.priorTax;
  const r17 = e.lastMonthTax;
  const r18 = e.delta;

  const box = (on: boolean) => (
    <span className={cn(
      "inline-flex h-3.5 w-3.5 items-center justify-center border border-slate-600 align-[-2px]",
      on && "bg-slate-800",
    )}>
      {on && <span className="text-[8px] font-black leading-none text-white">✓</span>}
    </span>
  );

  return (
    <PrintDoc orientation="portrait">
      {/* ============================ KOP FORMULIR ============================ */}
      <div className="flex items-stretch gap-3">
        <div className="flex-1 border-2 border-slate-800 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Direktorat Jenderal Pajak — Republik Indonesia
          </div>
          <h1 className="mt-0.5 text-[15px] font-extrabold uppercase leading-tight text-slate-900">
            {t("Bukti Potong PPh Pasal 21 bagi Pegawai Tetap", "PPh Article 21 Withholding Slip for Permanent Employees")}
          </h1>
          <div className="text-[11px] font-bold tracking-wide">FORM 1721-A1</div>
        </div>
        <div className="w-[62mm] shrink-0 border-2 border-slate-800">
          <div className="border-b border-slate-800 px-3 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider">{t("Nomor*", "Number*")}</div>
            <div className="font-mono text-[12px] font-bold">{data.formNo}</div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-800">
            <div className="px-3 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wider">{t("Masa Pajak*", "Tax Period*")}</div>
              <div className="font-mono text-[12px] font-bold tabular-nums">{String(e.monthLast ?? 12).padStart(2, "0")}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wider">{t("Tahun Pajak*", "Tax Year*")}</div>
              <div className="font-mono text-[12px] font-bold tabular-nums">{data.year}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== A. IDENTITAS PENERIMA PENGHASILAN ==================== */}
      <section className="mt-3 border-2 border-slate-800">
        <div className="border-b border-slate-800 bg-slate-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide">
          {t("A. Identitas Penerima Penghasilan", "A. Income Recipient Identity")}
        </div>
        <table className="w-full border-collapse text-[11.5px]">
          <tbody>
            <tr>
              <td className="w-12 border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">1.</td>
              <td className="w-[46mm] border border-slate-400 px-2 py-1">NPWP</td>
              <td className="border border-slate-400 px-2 py-1 font-mono font-semibold">{e.npwp ?? (e.hasNpwp ? "—" : t("Tidak memiliki NPWP", "No NPWP"))}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">2.</td>
              <td className="border border-slate-400 px-2 py-1">NIK</td>
              <td className="border border-slate-400 px-2 py-1 font-mono font-semibold">{e.nik || "—"}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">3.</td>
              <td className="border border-slate-400 px-2 py-1">{t("Nama dan Nama Jabatan", "Name and Position")}</td>
              <td className="border border-slate-400 px-2 py-1 font-bold">
                {e.employeeName} <span className="font-normal text-slate-500">— {e.positionName ?? e.orgUnitName ?? "—"}</span>
              </td>
            </tr>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">4.</td>
              <td className="border border-slate-400 px-2 py-1">{t("Alamat", "Address")}</td>
              <td className="border border-slate-400 px-2 py-1">{e.address || "—"}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">5.</td>
              <td className="border border-slate-400 px-2 py-1">{t("Status Karyawan", "Employee Status")}</td>
              <td className="border border-slate-400 px-2 py-1">
                {box(true)} {t("Pegawai Tetap", "Permanent Employee")} &nbsp;&nbsp; {box(false)} {t("Bukan Pegawai Tetap", "Non-Permanent Employee")}
              </td>
            </tr>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">6.</td>
              <td className="border border-slate-400 px-2 py-1">{t("Status Kawin", "Marital Status")}</td>
              <td className="border border-slate-400 px-2 py-1">
                {box(!isKawin)} TK &nbsp; {box(isKawin && !isGabung)} K &nbsp; {box(isKawin && isGabung)} K/I
                <span className="ml-3 text-slate-500">({t("wajib masa Desember / bulan berhenti", "due December / termination month")})</span>
              </td>
            </tr>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">7.</td>
              <td className="border border-slate-400 px-2 py-1">{t("Jumlah PT (tanggungan keluarga)", "Number of Dependents (PT)")}</td>
              <td className="border border-slate-400 px-2 py-1 font-mono font-bold tabular-nums">{dependents}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ============== B. RINCIAN PENGHASILAN & PENGHITUNGAN PPh 21 ============== */}
      <section className="mt-3 border-2 border-slate-800">
        <div className="border-b border-slate-800 bg-slate-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide">
          {t("B. Rincian Penghasilan dan Penghitungan PPh Pasal 21", "B. Income Detail and PPh Article 21 Computation")}
        </div>
        <table className="w-full border-collapse text-[11.5px]">
          <tbody>
            <FormRow no="1." label={t("Gaji/Pensiun", "Salary/Pension")} value={numRp(r1)} />
            <FormRow no="2." label={t("Tunjangan PPh", "PPh Allowance")} value={numRp(r2)} />
            <FormRow
              no="3."
              label={t("Tunjangan lainnya, uang lembur dan sejenisnya, termasuk iuran pensiun/THT/JHT yang dibayar pemberi kerja", "Other allowances, overtime and the like, including pension/THT/JHT contributions paid by the employer")}
              value={numRp(r3)}
            />
            <FormRow no="4." label={t("Premi asuransi yang dibayar pemberi kerja", "Insurance premiums paid by the employer")} value={numRp(r4)} />
            <FormRow no="5." label={t("Tantiem, bonus, gratifikasi, jasa produksi, THR", "Bonuses, gratuities, production fees, THR")} value={numRp(r5)} />
            <FormRow no="6." label={t("Penghasilan bruto (1+2+3+4+5)", "Gross income (1+2+3+4+5)")} value={numRp(r6)} strong />
            <FormRow no="7." label={t("Biaya jabatan (5% × No.6; maksimal Rp 6.000.000 setahun)", "Employment expense (5% × No.6; max Rp 6,000,000 per year)")} value={numRp(r7)} />
            <FormRow no="8." label={t("Iuran pensiun/THT/JHT (dibayar pegawai)", "Pension/THT/JHT contributions (paid by employee)")} value={numRp(r8)} />
            <FormRow no="9." label={t("Jumlah pengurang (7+8)", "Total deductions (7+8)")} value={numRp(r9)} />
            <FormRow no="10." label={t("Penghasilan neto masa pajak terakhir (6−9)", "Net income for the last tax period (6−9)")} value={numRp(r10)} />
            <FormRow no="11." label={t("Penghasilan neto masa pajak sebelumnya", "Net income for prior tax periods")} value={numRp(r11)} />
            <FormRow no="12." label={t("Jumlah penghasilan neto setahun / disetahunkan (10+11)", "Total net income annualized (10+11)")} value={numRp(r12)} strong />
            <tr>
              <td className="w-7 border border-slate-400 px-1 py-[3px] text-center align-top text-[10.5px] font-bold tabular-nums">13.</td>
              <td className="border border-slate-400 px-2 py-[3px] leading-snug">
                {t("Penghasilan Tidak Kena Pajak (PTKP) setahun:", "Non-Taxable Income (PTKP) per year:")}
                <table className="mt-0.5 w-full border-collapse text-[10.5px]">
                  <tbody>
                    <tr>
                      <td className="border border-slate-400 px-2 py-[2px] pl-6">a. {t("Diri sendiri", "Self")}</td>
                      <td className="w-[46mm] border border-slate-400 px-2 py-[2px] text-right tabular-nums">{numRp(PTKP_DIRI)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-400 px-2 py-[2px] pl-6">b. {t("Kawin", "Married")}</td>
                      <td className="border border-slate-400 px-2 py-[2px] text-right tabular-nums">{isKawin ? numRp(PTKP_KAWIN) : numRp(0)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-400 px-2 py-[2px] pl-6">c. {t("PTKP tambahan untuk tanggungan keluarga ({d} × Rp4.500.000)", "Additional PTKP for family dependents ({d} × Rp4,500,000)", { d: String(dependents) })}</td>
                      <td className="border border-slate-400 px-2 py-[2px] text-right tabular-nums">{numRp(dependents * PTKP_TANGGUNGAN)}</td>
                    </tr>
                    <tr className="bg-slate-100 font-bold">
                      <td className="border border-slate-400 px-2 py-[2px] pl-6">d. {t("Jumlah PTKP setahun", "Total PTKP per year")}</td>
                      <td className="border border-slate-400 px-2 py-[2px] text-right tabular-nums">{numRp(r13)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td className="w-[52mm] border border-slate-400 bg-slate-50" />
            </tr>
            <FormRow no="14." label={t("Penghasilan Kena Pajak (12−13)", "Taxable Income (12−13)")} value={numRp(r14)} strong />
            <FormRow no="15." label={t("PPh Pasal 21 terutang setahun (tarif Pasal 17 UU PPh)", "PPh Article 21 payable per year (Article 17 rates)")} value={numRp(r15)} strong />
            <FormRow no="16." label={t("PPh Pasal 21 telah dipotong masa pajak sebelumnya", "PPh Article 21 withheld for prior tax periods")} value={numRp(r16)} />
            <FormRow no="17." label={t("PPh Pasal 21 terutang masa pajak terakhir (15−16)", "PPh Article 21 payable for the last tax period (15−16)")} value={numRp(r17)} />
            <FormRow
              no="18."
              label={t("Kurang / (Lebih) Bayar (15−{w})", "Under / (Over) Paid (15−{w})", { w: money(e.taxWithheld) })}
              value={numRp(r18)}
              strong
            />
          </tbody>
        </table>
      </section>

      {/* ======================= C. IDENTITAS PEMOTONG ======================== */}
      <section className="mt-3 border-2 border-slate-800">
        <div className="border-b border-slate-800 bg-slate-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide">
          {t("C. Identitas Pemotong (Pemberi Kerja)", "C. Withholder (Employer) Identity")}
        </div>
        <div className="grid grid-cols-[1fr_auto]">
          <table className="w-full border-collapse text-[11.5px]">
            <tbody>
              <tr>
                <td className="w-12 border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">1.</td>
                <td className="w-[40mm] border border-slate-400 px-2 py-1">{t("Nama Pemotong", "Withholder Name")}</td>
                <td className="border border-slate-400 px-2 py-1 font-bold">{data.company?.name ?? "—"}</td>
              </tr>
              <tr>
                <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">2.</td>
                <td className="border border-slate-400 px-2 py-1">NPWP</td>
                <td className="border border-slate-400 px-2 py-1 font-mono font-semibold">{data.company?.taxId ?? "—"}</td>
              </tr>
              <tr>
                <td className="border border-slate-400 px-2 py-1 text-center text-[10.5px] font-bold">3.</td>
                <td className="border border-slate-400 px-2 py-1">{t("Alamat Pemotong", "Withholder Address")}</td>
                <td className="border border-slate-400 px-2 py-1">
                  {[data.company?.address, data.company?.city].filter(Boolean).join(", ") || "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flex w-[52mm] flex-col items-center justify-center border-l-2 border-slate-800 px-2 py-3 text-center">
            <div className="text-[10px] font-semibold leading-tight text-slate-600">
              {t("{city}, {date}", "{city}, {date}", {
                city: data.company?.city ?? "…………",
                date: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(data.officer.printedAt)),
              })}
            </div>
            <div className="h-16" aria-hidden />
            <div className="w-full border-t border-slate-500 pt-1 text-[11px] font-bold">{data.officer.name}</div>
            <div className="text-[9px] uppercase tracking-wide text-slate-500">{t("Pemotong PPh 21 / Payroll Officer", "PPh 21 Withholder / Payroll Officer")}</div>
          </div>
        </div>
      </section>

      <p className="mt-2.5 text-[9.5px] italic leading-snug text-slate-500">
        {t(
          "* Nomor, masa & tahun mengikuti konvensi e-Bupot 21/26 (nomor 21.0-<masa>-<urut>). Masa pajak = masa terakhir penerima penghasilan. Nilai baris 1-18 disusun dari rekap SPT tahunan internal — rekonsiliasi resmi melalui impor CSV e-SPT 1721-A1 (menu SPT & Pajak). Formulir mengikuti kerangka PER-21/PJ/2009 jo. PMK 34/2021.",
          "* Number, period & year follow e-Bupot 21/26 conventions (number 21.0-<period>-<seq>). Tax period = the recipient's last income period. Rows 1-18 are compiled from the internal annual SPT recap — official reconciliation via the e-SPT 1721-A1 CSV import (SPT & Tax menu). The form follows the PER-21/PJ/2009 as amended by PMK 34/2021 framework.",
        )}
      </p>
      <Confidentiality />
    </PrintDoc>
  );
}
