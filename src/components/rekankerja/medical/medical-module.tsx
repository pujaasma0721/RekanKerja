"use client";
// RekanKerja — Modul Medical: router view (padanan Medical Benefit oranHR)
import { MedicalOverview } from "@/components/rekankerja/medical/medical-overview";
import { MedicalInfoPage } from "@/components/rekankerja/medical/medical-info";
import { MedicalClaimsPage } from "@/components/rekankerja/medical/medical-claims";
import { MedicalApprovalPage } from "@/components/rekankerja/medical/medical-approval";
import { MedicalAdjustmentPage } from "@/components/rekankerja/medical/medical-adjustment";
import { MedicalBenefitTypePage } from "@/components/rekankerja/medical/medical-benefit-type";
import { MedicalProvidersPage } from "@/components/rekankerja/medical/medical-providers";
import { MedicalReportsPage } from "@/components/rekankerja/medical/medical-reports";

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
