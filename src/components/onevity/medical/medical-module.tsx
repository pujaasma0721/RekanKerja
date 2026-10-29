"use client";
// OneVity — Modul Medical: router view (padanan Medical Benefit oranHR)
import { MedicalOverview } from "@/components/onevity/medical/medical-overview";
import { MedicalInfoPage } from "@/components/onevity/medical/medical-info";
import { MedicalClaimsPage } from "@/components/onevity/medical/medical-claims";
import { MedicalApprovalPage } from "@/components/onevity/medical/medical-approval";
import { MedicalAdjustmentPage } from "@/components/onevity/medical/medical-adjustment";
import { MedicalBenefitTypePage } from "@/components/onevity/medical/medical-benefit-type";
import { MedicalProvidersPage } from "@/components/onevity/medical/medical-providers";
import { MedicalReportsPage } from "@/components/onevity/medical/medical-reports";

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
