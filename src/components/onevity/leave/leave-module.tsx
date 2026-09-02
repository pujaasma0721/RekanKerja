"use client";
// OneVity — Modul Leave: router view (padanan Leave Administration oranHR)
import { LeaveOverview } from "@/components/onevity/leave/leave-overview";
import { LeaveTypesPage } from "@/components/onevity/leave/leave-templates";
import { LeaveBalancesPage } from "@/components/onevity/leave/leave-balances";
import { LeaveRequestsPage } from "@/components/onevity/leave/leave-requests";
import { LeaveApprovalPage } from "@/components/onevity/leave/leave-approval";
import { LeaveMassPage } from "@/components/onevity/leave/leave-mass";
import { LeaveEncashmentPage } from "@/components/onevity/leave/leave-encashment";
import { LeaveReportsPage } from "@/components/onevity/leave/leave-reports";

export function LeaveModule({ view }: { view: string }) {
  switch (view) {
    case "leave-info": return <LeaveBalancesPage />;
    case "leave-request": return <LeaveRequestsPage />;
    case "leave-approval": return <LeaveApprovalPage />;
    case "leave-mass": return <LeaveMassPage />;
    case "leave-type": return <LeaveTypesPage />;
    case "leave-encashment": return <LeaveEncashmentPage />;
    case "leave-reports": return <LeaveReportsPage />;
    default: return <LeaveOverview />;
  }
}
