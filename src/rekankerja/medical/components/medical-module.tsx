"use client";
// RekanKerja — Modul Medical: router view (padanan Medical Benefit)
import { MedicalOverview } from "@/rekankerja/medical/components/medical-overview";
import { MedicalInfoPage } from "@/rekankerja/medical/components/medical-info";
import { MedicalClaimsPage } from "@/rekankerja/medical/components/medical-claims";
import { MedicalApprovalPage } from "@/rekankerja/medical/components/medical-approval";
import { MedicalAdjustmentPage } from "@/rekankerja/medical/components/medical-adjustment";
import { MedicalBenefitTypePage } from "@/rekankerja/medical/components/medical-benefit-type";
import { MedicalProvidersPage } from "@/rekankerja/medical/components/medical-providers";
import { MedicalReportsPage } from "@/rekankerja/medical/components/medical-reports";

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
