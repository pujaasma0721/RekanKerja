"use client";
// OneVity — Modul Payroll: router view (Ringkasan, Periode, Proses & Hasil, Master,
// Transaksi, Benefit, Laporan Tahunan, Parameter/Jurnal)
import { PayrollOverview } from "@/components/onevity/payroll/payroll-overview";
import { PayrollPeriodsPage } from "@/components/onevity/payroll/payroll-periods";
import { PayrollRunsPage } from "@/components/onevity/payroll/payroll-runs";
import { PayrollRunDetailPage } from "@/components/onevity/payroll/payroll-run-detail";
import { WageComponentsPage } from "@/components/onevity/payroll/wage-components";
import { PayrollTemplatesPage } from "@/components/onevity/payroll/payroll-templates";
import { PayrollProfilesPage } from "@/components/onevity/payroll/payroll-profiles";
import { PayrollTransactionsPage } from "@/components/onevity/payroll/payroll-transactions";
import { PayrollParametersPage } from "@/components/onevity/payroll/payroll-parameters";
import { AccountingPage } from "@/components/onevity/payroll/accounting";
import { PayrollSptPage } from "@/components/onevity/payroll/payroll-spt";
import { PayrollJournalsPage } from "@/components/onevity/payroll/payroll-journals";
import { PayrollBenefitsPage } from "@/components/onevity/payroll/payroll-benefits";

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
