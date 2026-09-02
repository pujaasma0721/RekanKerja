"use client";
// OneVity — Modul Travel: router view (padanan Travel Administration oranHR)
import { TravelOverview } from "@/onevity/travel/components/travel-overview";
import { TravelRequestsPage } from "@/onevity/travel/components/travel-requests";
import { TravelApprovalPage } from "@/onevity/travel/components/travel-approval";
import { TravelClaimsPage } from "@/onevity/travel/components/travel-claims";
import { TravelClaimApprovalPage } from "@/onevity/travel/components/travel-claim-approval";
import { TravelBudgetPage } from "@/onevity/travel/components/travel-budget";
import { TravelTemplatesPage } from "@/onevity/travel/components/travel-templates";
import { TravelReportsPage } from "@/onevity/travel/components/travel-reports";

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
