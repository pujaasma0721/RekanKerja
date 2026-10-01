"use client";
// RekanKerja — Modul Travel: router view (padanan Travel Administration)
import { TravelOverview } from "@/rekankerja/travel/components/travel-overview";
import { TravelRequestsPage } from "@/rekankerja/travel/components/travel-requests";
import { TravelApprovalPage } from "@/rekankerja/travel/components/travel-approval";
import { TravelClaimsPage } from "@/rekankerja/travel/components/travel-claims";
import { TravelClaimApprovalPage } from "@/rekankerja/travel/components/travel-claim-approval";
import { TravelBudgetPage } from "@/rekankerja/travel/components/travel-budget";
import { TravelTemplatesPage } from "@/rekankerja/travel/components/travel-templates";
import { TravelReportsPage } from "@/rekankerja/travel/components/travel-reports";

export function TravelModule({ view }: { view: string }) {
  switch (view) {
    case "travel-request": return <TravelRequestsPage />;
    case "travel-approval": return <TravelApprovalPage />;
    case "travel-claim": return <TravelClaimsPage />;
    case "travel-claim-approval": return <TravelClaimApprovalPage />;
    case "travel-budget": return <TravelBudgetPage />;
    case "travel-templates": return <TravelTemplatesPage />;
    case "travel-reports": return <TravelReportsPage />;
    default: return <TravelOverview />;
  }
}
