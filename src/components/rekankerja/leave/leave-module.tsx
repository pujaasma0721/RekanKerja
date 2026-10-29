"use client";
// RekanKerja — Modul Leave: router view (padanan Leave Administration oranHR)
import { LeaveOverview } from "@/components/rekankerja/leave/leave-overview";
import { LeaveTypesPage } from "@/components/rekankerja/leave/leave-templates";
import { LeaveBalancesPage } from "@/components/rekankerja/leave/leave-balances";
import { LeaveRequestsPage } from "@/components/rekankerja/leave/leave-requests";
import { LeaveApprovalPage } from "@/components/rekankerja/leave/leave-approval";
import { LeaveMassPage } from "@/components/rekankerja/leave/leave-mass";
import { LeaveEncashmentPage } from "@/components/rekankerja/leave/leave-encashment";
import { LeaveReportsPage } from "@/components/rekankerja/leave/leave-reports";

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
