"use client";
// OneVity — Modul Travel: router view (padanan Travel Administration oranHR)
import { TravelOverview } from "@/components/onevity/travel/travel-overview";
import { TravelRequestsPage } from "@/components/onevity/travel/travel-requests";
import { TravelApprovalPage } from "@/components/onevity/travel/travel-approval";
import { TravelClaimsPage } from "@/components/onevity/travel/travel-claims";
import { TravelClaimApprovalPage } from "@/components/onevity/travel/travel-claim-approval";
import { TravelBudgetPage } from "@/components/onevity/travel/travel-budget";
import { TravelTemplatesPage } from "@/components/onevity/travel/travel-templates";
import { TravelReportsPage } from "@/components/onevity/travel/travel-reports";

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
