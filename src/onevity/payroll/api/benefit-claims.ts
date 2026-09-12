import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
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
    // M-8: amount klaim tersimpan TERENKRIPSI — statistik dihitung dari nilai
    // terdekripsi per baris (fetch rows + reduce in-memory; agregasi SQL pada
    // kolom terenkripsi dilarang).
    const tc = tenantCryptoForDb(db);
    const all = (await db.benefitClaim.findMany({ select: { status: true, amount: true, claimDate: true } }))
      .map((c) => ({ ...c, amount: tc.decryptMoney(c.amount) ?? 0 }));
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
    // M-8: rows klaim di-dekripsi di batas serializer (decryptJson) — bentuk
    // JSON frontend TIDAK berubah (amount/approvedAmount/limitUsed/
    // limitRemaining tetap angka).
    return NextResponse.json(tenantCryptoForDb(db).decryptJson({ claims, stats }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/benefit-claims — ajukan klaim (limit check + auto-approve).
// Task 32-d: guard hak AKSI menu — create pada payroll:benefits (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:benefits", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const res = await submitClaim(db, {
      employeeId: b.employeeId,
      benefitTypeId: b.benefitTypeId,
      amount: Number(b.amount),
      claimDate: b.claimDate,
      description: b.description,
      documentsNote: b.documentsNote,
    });
    // M-8: klaim tersimpan terenkripsi — dekripsi di batas respons.
    return NextResponse.json(tenantCryptoForDb(db).decryptJson(res), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH /api/onevity/benefit-claims — action: approve|reject|schedule|markPaid|cancel.
export async function PATCH(req: NextRequest) {
  try {
    // Guard mutasi (audit C-02): VIEWER ditolak 403; approve tercatat dari
    // aktor SESI nyata (bukan payload klien) → kolom BenefitClaim.approvedBy.
    // Task 32-d: guard hak AKSI menu per pengguna — approve/reject → op:approve,
    // schedule → op:schedule, markPaid → op:markPaid, cancel → update pada
    // payroll:benefits. Body dibaca SEKALI sebelum guard (aksi menentukan op yang dicek).
    const b = await req.json();
    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    if (!["approve", "reject", "schedule", "markPaid", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
    const m = b.action === "approve" || b.action === "reject"
      ? await requireMenuAction(req, "payroll:benefits", "op:approve")
      : b.action === "schedule"
        ? await requireMenuAction(req, "payroll:benefits", "op:schedule")
        : b.action === "markPaid"
          ? await requireMenuAction(req, "payroll:benefits", "op:markPaid")
          : await requireMenuAction(req, "payroll:benefits", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    let claim: unknown;
    switch (b.action) {
      case "approve":
        claim = await approveClaim(db, b.id, actor.appUsername ?? actor.name);
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
    return NextResponse.json(tenantCryptoForDb(db).decryptJson({ claim }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
