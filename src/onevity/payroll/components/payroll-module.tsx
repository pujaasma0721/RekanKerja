"use client";
// OneVity — Modul Payroll: router view (Ringkasan, Periode, Proses & Hasil, Master,
// Transaksi, Benefit, Laporan Tahunan, Parameter/Jurnal)
import { PayrollOverview } from "@/onevity/payroll/components/payroll-overview";
import { PayrollPeriodsPage } from "@/onevity/payroll/components/payroll-periods";
import { PayrollRunsPage } from "@/onevity/payroll/components/payroll-runs";
import { PayrollRunDetailPage } from "@/onevity/payroll/components/payroll-run-detail";
import { WageComponentsPage } from "@/onevity/payroll/components/wage-components";
import { PayrollTemplatesPage } from "@/onevity/payroll/components/payroll-templates";
import { PayrollProfilesPage } from "@/onevity/payroll/components/payroll-profiles";
import { PayrollTransactionsPage } from "@/onevity/payroll/components/payroll-transactions";
import { PayrollParametersPage } from "@/onevity/payroll/components/payroll-parameters";
import { AccountingPage } from "@/onevity/payroll/components/accounting";
import { PayrollSptPage } from "@/onevity/payroll/components/payroll-spt";
import { PayrollJournalsPage } from "@/onevity/payroll/components/payroll-journals";
import { PayrollBenefitsPage } from "@/onevity/payroll/components/payroll-benefits";

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
