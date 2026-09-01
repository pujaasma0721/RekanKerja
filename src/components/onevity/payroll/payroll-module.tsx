"use client";
// OneVity — Modul Payroll: router view (Ringkasan, Periode, Proses & Hasil, Master, Transaksi, Parameter)
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

export function PayrollModule({ view }: { view: string }) {
  switch (view) {
    case "periods": return <PayrollPeriodsPage />;
    case "runs": return <PayrollRunsPage />;
    case "run": return <PayrollRunDetailPage />;
    case "components": return <WageComponentsPage />;
    case "templates": return <PayrollTemplatesPage />;
    case "profiles": return <PayrollProfilesPage />;
    case "transactions": return <PayrollTransactionsPage />;
    case "parameters": return <PayrollParametersPage />;
    case "accounting": return <AccountingPage />;
    default: return <PayrollOverview />;
  }
}
