// RekanKerja Payroll SPT (P4) — rekap PPh21 tahunan (1721-A1) per karyawan.
// Sumber data: snapshot PayrollRunLine + PayrollRunItem dari semua run
// Confirmed/Paid pada tahun pajak (period.sptYear). Perhitungan:
//   bruto kena pajak setahun (Regular + Irregular)
//   − biaya jabatan (5%, cap 6 jt/thn)
//   − iuran JSTK pegawai (JHT/JP, deductible)
//   = neto setahun → − PTKP tahunan → PKP → progresif Pasal 17 setahun
//   vs PPh21 yang telah dipotong bulanan (taxR + taxI) → kurang/lebih bayar.
import type { TenantDb } from "@/lib/rekankerja/tenant-db";
import { progressiveTax, EngineBracket } from "@/lib/rekankerja/payroll-engine";
import { getBrackets, getActiveRegulation } from "@/lib/rekankerja/payroll-service";

export interface SptEmployeeRow {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  orgUnitName: string | null;
  positionName: string | null;
  npwp: string | null;
  hasNpwp: boolean;
  taxStatus: string;
  ptkpAnnual: number;
  runs: number;
  incomeRegular: number;
  incomeIrregular: number;
  incomeNonTaxable: number;
  incomeFinal: number;
  brutoTaxable: number;
  biayaJabatan: number;
  iuranJstk: number;
  neto: number;
  pkp: number;
  pph21Annual: number;
  taxWithheld: number;
  delta: number; // > 0 kurang bayar, < 0 lebih bayar
}

export interface SptReport {
  year: number;
  employees: SptEmployeeRow[];
  totals: {
    employees: number;
    brutoTaxable: number;
    biayaJabatan: number;
    iuranJstk: number;
    neto: number;
    pph21Annual: number;
    taxWithheld: number;
    delta: number;
  };
  regulation: { biayaJabatanRate: number; biayaJabatanCapAnnual: number };
}

const FINAL_METHODS = new Set(["FixedRateFinal", "SeveranceFinal", "PensionFinal", "Final2Years"]);

export async function buildAnnualSpt(db: TenantDb, year: number): Promise<SptReport> {
  const runs = await db.payrollRun.findMany({
    where: { status: { in: ["Confirmed", "Paid"] }, period: { sptYear: year } },
    include: {
      lines: {
        include: {
          items: true,
          employee: { include: { payrollProfile: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const [reg, brackets] = await Promise.all([getActiveRegulation(db), getBrackets(db)]);
  const biayaJabatanCapAnnual = reg.biayaJabatanCapMonthly * 12;

  const byEmp = new Map<string, SptEmployeeRow>();
  for (const run of runs) {
    for (const line of run.lines) {
      let row = byEmp.get(line.employeeId);
      if (!row) {
        const profile = line.employee?.payrollProfile;
        row = {
          employeeId: line.employeeId,
          employeeNo: line.employeeNo,
          employeeName: line.employeeName,
          orgUnitName: line.orgUnitName,
          positionName: line.positionName,
          npwp: profile?.npwp ?? line.employee?.taxId ?? null,
          hasNpwp: profile?.hasNpwp ?? true,
          taxStatus: line.ptkpStatus,
          ptkpAnnual: line.ptkpValue,
          runs: 0,
          incomeRegular: 0,
          incomeIrregular: 0,
          incomeNonTaxable: 0,
          incomeFinal: 0,
          brutoTaxable: 0,
          biayaJabatan: 0,
          iuranJstk: 0,
          neto: 0,
          pkp: 0,
          pph21Annual: 0,
          taxWithheld: 0,
          delta: 0,
        };
        byEmp.set(line.employeeId, row);
      }
      row.runs += 1;
      row.taxWithheld += line.taxRegular + line.taxIrregular;
      // PTKP: pakai snapshot terbaru (klasifikasi bisa berubah tengah tahun).
      row.ptkpAnnual = line.ptkpValue;
      row.taxStatus = line.ptkpStatus;

      for (const item of line.items) {
        if (item.type === "Earning") {
          if (item.incomeTaxMethod === "Regular") row.incomeRegular += item.amount;
          else if (item.incomeTaxMethod === "Irregular") row.incomeIrregular += item.amount;
          else if (FINAL_METHODS.has(item.incomeTaxMethod)) row.incomeFinal += item.amount;
          else row.incomeNonTaxable += item.amount;
        } else if (item.type === "Deduction" && item.wageType === "Jamsostek") {
          row.iuranJstk += item.amount;
        }
      }
    }
  }

  const employees = [...byEmp.values()].map((r) => {
    const brutoTaxable = Math.round(r.incomeRegular + r.incomeIrregular);
    const biayaJabatan = Math.round(Math.min(brutoTaxable * reg.biayaJabatanRate, biayaJabatanCapAnnual));
    const iuranJstk = Math.round(r.iuranJstk);
    const neto = brutoTaxable - biayaJabatan - iuranJstk;
    const pkp = Math.max(0, Math.floor((neto - r.ptkpAnnual) / 1000) * 1000);
    const pph21Annual = Math.round(progressiveTax(pkp, brackets as EngineBracket[], r.hasNpwp));
    return { ...r, brutoTaxable, biayaJabatan, iuranJstk, neto, pkp, pph21Annual, delta: pph21Annual - Math.round(r.taxWithheld) };
  }).sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const totals = employees.reduce(
    (t, r) => ({
      employees: t.employees + 1,
      brutoTaxable: t.brutoTaxable + r.brutoTaxable,
      biayaJabatan: t.biayaJabatan + r.biayaJabatan,
      iuranJstk: t.iuranJstk + r.iuranJstk,
      neto: t.neto + r.neto,
      pph21Annual: t.pph21Annual + r.pph21Annual,
      taxWithheld: t.taxWithheld + r.taxWithheld,
      delta: t.delta + r.delta,
    }),
    { employees: 0, brutoTaxable: 0, biayaJabatan: 0, iuranJstk: 0, neto: 0, pph21Annual: 0, taxWithheld: 0, delta: 0 }
  );

  return { year, employees, totals, regulation: { biayaJabatanRate: reg.biayaJabatanRate, biayaJabatanCapAnnual } };
}
