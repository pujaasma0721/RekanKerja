"use client";
// OneVity — Modul Medical: router view (padanan Medical Benefit)
import { MedicalOverview } from "@/onevity/medical/components/medical-overview";
import { MedicalInfoPage } from "@/onevity/medical/components/medical-info";
import { MedicalClaimsPage } from "@/onevity/medical/components/medical-claims";
import { MedicalApprovalPage } from "@/onevity/medical/components/medical-approval";
import { MedicalAdjustmentPage } from "@/onevity/medical/components/medical-adjustment";
import { MedicalBenefitTypePage } from "@/onevity/medical/components/medical-benefit-type";
import { MedicalProvidersPage } from "@/onevity/medical/components/medical-providers";
import { MedicalReportsPage } from "@/onevity/medical/components/medical-reports";

export function MedicalModule({ view }: { view: string }) {
  switch (view) {
    case "medical-info": return <MedicalInfoPage />;
    case "medical-claim": return <MedicalClaimsPage />;
    case "medical-approval": return <MedicalApprovalPage />;
    case "medical-adjustment": return <MedicalAdjustmentPage />;
    case "medical-benefit-type": return <MedicalBenefitTypePage />;
    case "medical-providers": return <MedicalProvidersPage />;
    case "medical-reports": return <MedicalReportsPage />;
    default: return <MedicalOverview />;
  }
}
