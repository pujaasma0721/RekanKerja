"use client";
// RekanKerja — Modul Leave: router view (padanan Leave Administration)
import { LeaveOverview } from "@/rekankerja/leave/components/leave-overview";
import { LeaveTypesPage } from "@/rekankerja/leave/components/leave-templates";
import { LeaveBalancesPage } from "@/rekankerja/leave/components/leave-balances";
import { LeaveRequestsPage } from "@/rekankerja/leave/components/leave-requests";
import { LeaveApprovalPage } from "@/rekankerja/leave/components/leave-approval";
import { LeaveMassPage } from "@/rekankerja/leave/components/leave-mass";
import { LeaveEncashmentPage } from "@/rekankerja/leave/components/leave-encashment";
import { LeaveReportsPage } from "@/rekankerja/leave/components/leave-reports";

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
