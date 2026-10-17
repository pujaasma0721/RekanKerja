"use client";
// RekanKerja — Modul Payroll: router view (Ringkasan, Periode, Proses & Hasil, Master,
// Transaksi, Benefit, Bukan Pegawai, Laporan Tahunan, Parameter/Jurnal)
import { PayrollOverview } from "@/rekankerja/payroll/components/payroll-overview";
import { PayrollPeriodsPage } from "@/rekankerja/payroll/components/payroll-periods";
import { PayrollRunsPage } from "@/rekankerja/payroll/components/payroll-runs";
import { PayrollRunDetailPage } from "@/rekankerja/payroll/components/payroll-run-detail";
import { WageComponentsPage } from "@/rekankerja/payroll/components/wage-components";
import { PayrollTemplatesPage } from "@/rekankerja/payroll/components/payroll-templates";
import { PayrollProfilesPage } from "@/rekankerja/payroll/components/payroll-profiles";
import { PayrollTransactionsPage } from "@/rekankerja/payroll/components/payroll-transactions";
import { PayrollParametersPage } from "@/rekankerja/payroll/components/payroll-parameters";
import { AccountingPage } from "@/rekankerja/payroll/components/accounting";
import { PayrollSptPage } from "@/rekankerja/payroll/components/payroll-spt";
import { PayrollJournalsPage } from "@/rekankerja/payroll/components/payroll-journals";
import { PayrollBenefitsPage } from "@/rekankerja/payroll/components/payroll-benefits";
// PMK 168/2023 — pembayaran honor/fee ke pihak non-karyawan (PPh21 final
// DPP 50% × tarif Pasal 17), terpisah dari engine payroll karyawan.
import { NonEmployeePaymentsPage } from "@/rekankerja/payroll/components/non-employee-payments";
import { PayrollReportsPage } from "@/rekankerja/payroll/components/reports/payroll-reports-view";
// B5-BL — benchmark gaji pasar (D-BL16/D-BL17): master impor survei + kompa-ratio.
import { PayrollBenchmarkPage } from "@/rekankerja/payroll/components/payroll-benchmark";
// P1.4-BM (D-BM9) — simulasi THP stateless (engine TER + Pasal 17 yang sama).
import { PayrollSimulationPage } from "@/rekankerja/payroll/components/payroll-simulation";

export function PayrollModule({ view }: { view: string }) {
  switch (view) {
    case "periods": return <PayrollPeriodsPage />;
    case "runs": return <PayrollRunsPage />;
    case "run": return <PayrollRunDetailPage />;
    // P1.4-BM (D-BM9) — nav "simulation" (id terdaftar di app-shell PAYROLL_NAV).
    case "simulation": return <PayrollSimulationPage />;
    case "components": return <WageComponentsPage />;
    case "templates": return <PayrollTemplatesPage />;
    case "profiles": return <PayrollProfilesPage />;
    case "transactions": return <PayrollTransactionsPage />;
    case "benefits": return <PayrollBenefitsPage />;
    case "non-employee": return <NonEmployeePaymentsPage />;
    case "benchmark": return <PayrollBenchmarkPage />;
    case "reports": return <PayrollReportsPage />;
    case "parameters": return <PayrollParametersPage />;
    case "accounting": return <AccountingPage />;
    case "spt": return <PayrollSptPage />;
    case "journals": return <PayrollJournalsPage />;
    default: return <PayrollOverview />;
  }
}
