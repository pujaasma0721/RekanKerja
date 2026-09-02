import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import {
  submitClaim, approveClaim, rejectClaim, scheduleClaim, markClaimPaidCash, cancelClaim,
} from "@/onevity/payroll/services/benefit-service";

const CLAIM_INCLUDE = {
  benefitType: {
    select: {
      id: true, code: true, name: true, category: true, resetPeriod: true, maxClaimAmount: true,
      unlimited: true, allowOverlimit: true, autoApproveInLimit: true, payInPayroll: true,
      needDocuments: true, wageComponentId: true,
    },
  },
  employee: { select: { employeeNo: true, fullName: true } },
  period: { select: { code: true, name: true, status: true } },
} as const;

// GET /api/onevity/benefit-claims?status=&employeeId= — daftar + statistik.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const status = req.nextUrl.searchParams.get("status");
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const claims = await db.benefitClaim.findMany({
      where: {
        ...(status && status !== "all" ? { status } : {}),
        ...(employeeId ? { employeeId } : {}),
      },
      include: CLAIM_INCLUDE,
      orderBy: [{ claimDate: "desc" }, { claimNo: "desc" }],
    });
    const all = await db.benefitClaim.findMany({ select: { status: true, amount: true, claimDate: true } });
    const year = new Date().getFullYear();
    const stats = {
      total: all.length,
      pending: all.filter((c) => c.status === "Pending").length,
      pendingAmount: all.filter((c) => c.status === "Pending").reduce((s, c) => s + c.amount, 0),
      approvedCount: all.filter((c) => c.status === "Approved" || c.status === "Scheduled").length,
      approvedAmount: all.filter((c) => c.status === "Approved" || c.status === "Scheduled").reduce((s, c) => s + c.amount, 0),
      scheduledCount: all.filter((c) => c.status === "Scheduled").length,
      paidCount: all.filter((c) => c.status === "Paid").length,
      paidAmount: all.filter((c) => c.status === "Paid").reduce((s, c) => s + c.amount, 0),
      rejectedCount: all.filter((c) => c.status === "Rejected").length,
      ytdAmount: all.filter((c) => c.status === "Paid" && c.claimDate.getFullYear() === year).reduce((s, c) => s + c.amount, 0),
    };
    return NextResponse.json({ claims, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/benefit-claims — ajukan klaim (limit check + auto-approve).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    const res = await submitClaim(db, {
      employeeId: b.employeeId,
      benefitTypeId: b.benefitTypeId,
      amount: Number(b.amount),
      claimDate: b.claimDate,
      description: b.description,
      documentsNote: b.documentsNote,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH /api/onevity/benefit-claims — action: approve|reject|schedule|markPaid|cancel.
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    let claim: unknown;
    switch (b.action) {
      case "approve":
        claim = await approveClaim(db, b.id, b.approvedBy);
        break;
      case "reject":
        claim = await rejectClaim(db, b.id, b.reason ?? "");
        break;
      case "schedule":
        if (!b.periodId) return NextResponse.json({ error: "periodId wajib utk schedule" }, { status: 400 });
        claim = await scheduleClaim(db, b.id, b.periodId);
        break;
      case "markPaid":
        claim = await markClaimPaidCash(db, b.id);
        break;
      case "cancel":
        claim = await cancelClaim(db, b.id);
        break;
      default:
        return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
    return NextResponse.json({ claim });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
