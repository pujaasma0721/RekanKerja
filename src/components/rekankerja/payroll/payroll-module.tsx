"use client";
// RekanKerja — Modul Payroll: router view (Ringkasan, Periode, Proses & Hasil, Master,
// Transaksi, Benefit, Laporan Tahunan, Parameter/Jurnal)
import { PayrollOverview } from "@/components/rekankerja/payroll/payroll-overview";
import { PayrollPeriodsPage } from "@/components/rekankerja/payroll/payroll-periods";
import { PayrollRunsPage } from "@/components/rekankerja/payroll/payroll-runs";
import { PayrollRunDetailPage } from "@/components/rekankerja/payroll/payroll-run-detail";
import { WageComponentsPage } from "@/components/rekankerja/payroll/wage-components";
import { PayrollTemplatesPage } from "@/components/rekankerja/payroll/payroll-templates";
import { PayrollProfilesPage } from "@/components/rekankerja/payroll/payroll-profiles";
import { PayrollTransactionsPage } from "@/components/rekankerja/payroll/payroll-transactions";
import { PayrollParametersPage } from "@/components/rekankerja/payroll/payroll-parameters";
import { AccountingPage } from "@/components/rekankerja/payroll/accounting";
import { PayrollSptPage } from "@/components/rekankerja/payroll/payroll-spt";
import { PayrollJournalsPage } from "@/components/rekankerja/payroll/payroll-journals";
import { PayrollBenefitsPage } from "@/components/rekankerja/payroll/payroll-benefits";

export function PayrollModule({ view }: { view: string }) {
  switch (view) {
    case "periods": return <PayrollPeriodsPage />;
    case "runs": return <PayrollRunsPage />;
    case "run": return <PayrollRunDetailPage />;
    case "components": return <WageComponentsPage />;
    case "templates": return <PayrollTemplatesPage />;
    case "profiles": return <PayrollProfilesPage />;
    case "transactions": return <PayrollTransactionsPage />;
    case "benefits": return <PayrollBenefitsPage />;
    case "parameters": return <PayrollParametersPage />;
    case "accounting": return <AccountingPage />;
    case "spt": return <PayrollSptPage />;
    case "journals": return <PayrollJournalsPage />;
    default: return <PayrollOverview />;
  }
}
