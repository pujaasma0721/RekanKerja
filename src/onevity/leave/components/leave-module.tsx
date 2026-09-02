"use client";
// OneVity — Modul Leave: router view (padanan Leave Administration oranHR)
import { LeaveOverview } from "@/onevity/leave/components/leave-overview";
import { LeaveTypesPage } from "@/onevity/leave/components/leave-templates";
import { LeaveBalancesPage } from "@/onevity/leave/components/leave-balances";
import { LeaveRequestsPage } from "@/onevity/leave/components/leave-requests";
import { LeaveApprovalPage } from "@/onevity/leave/components/leave-approval";
import { LeaveMassPage } from "@/onevity/leave/components/leave-mass";
import { LeaveEncashmentPage } from "@/onevity/leave/components/leave-encashment";
import { LeaveReportsPage } from "@/onevity/leave/components/leave-reports";

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
