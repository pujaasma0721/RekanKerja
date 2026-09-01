import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const [pendingActions, activeEmployees, companies, payrollDraftRuns, benefitPendingClaims] = await Promise.all([
      db.personnelAction.count({ where: { status: "Submitted" } }),
      db.employee.count({ where: { status: "Active" } }),
      db.company.findFirst({ where: { active: true } }),
      db.payrollRun.count({ where: { status: { in: ["Draft", "Calculated"] } } }),
      db.benefitClaim.count({ where: { status: "Pending" } }),
    ]);
    return NextResponse.json({ pendingActions, activeEmployees, company: companies, payrollDraftRuns, benefitPendingClaims });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
