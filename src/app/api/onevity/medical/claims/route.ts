import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { readSessionCookie } from "@/lib/onevity/auth";
import { listClaims, submitClaim, decideClaim, previewClaim } from "@/lib/onevity/medical-service";

// GET /api/onevity/medical/claims?state=&year=&employeeId=&typeId=&preview=
// &employeeId&typeId — daftar klaim (padanan MedicalBenefitClaim.jsp /
// MedicalBenefitClaimToApprove.jsp); preview=1 → snapshot saldo sebelum ajukan.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    if (sp.get("preview") === "1") {
      const employeeId = sp.get("employeeId");
      const typeId = sp.get("typeId");
      if (!employeeId || !typeId) {
        return NextResponse.json({ error: "employeeId & typeId wajib utk preview" }, { status: 400 });
      }
      const year = Number(sp.get("year") ?? new Date().getFullYear());
      const preview = await previewClaim(db, { employeeId, typeId, year });
      return NextResponse.json({ preview });
    }
    const includeLines = sp.get("includeLines") === "1";
    const claims = await listClaims(db, {
      state: sp.get("state") ?? "all",
      year: sp.get("year") ? Number(sp.get("year")) : undefined,
      employeeId: sp.get("employeeId") ?? undefined,
      typeId: sp.get("typeId") ?? undefined,
      includeLines,
    });
    const stats = {
      total: claims.length,
      draft: claims.filter((c) => c.state === "Draft").length,
      submitted: claims.filter((c) => c.state === "Submitted").length,
      approved: claims.filter((c) => c.state === "Approved").length,
      settled: claims.filter((c) => c.state === "Settled").length,
      rejected: claims.filter((c) => c.state === "Rejected").length,
      cancelled: claims.filter((c) => c.state === "Cancelled").length,
      pendingAmount: claims
        .filter((c) => c.state === "Submitted" || c.state === "Approved")
        .reduce((s, c) => s + c.totalApproved, 0),
      settledAmount: claims.filter((c) => c.state === "Settled").reduce((s, c) => s + c.totalApproved, 0),
    };
    return NextResponse.json({ claims, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan klaim medis (baris perawatan multi: treated/diagnosa/kwitansi/
// dokter/RS + bill/reimburse/approved) — padanan Medical Claim form + ESS wizard.
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const actor = readSessionCookie(req);
    const actorId = actor?.uid ?? "system";
    const b = await req.json();
    if (!b.employeeId || !b.typeId || !b.claimDate || !Array.isArray(b.lines) || b.lines.length === 0) {
      return NextResponse.json({ error: "employeeId, typeId, claimDate & lines wajib" }, { status: 400 });
    }
    const res = await submitClaim(db, {
      employeeId: String(b.employeeId),
      typeId: String(b.typeId),
      claimDate: String(b.claimDate),
      letterNo: b.letterNo ? String(b.letterNo) : undefined,
      forDependent: Boolean(b.forDependent),
      note: b.note ? String(b.note) : undefined,
      submit: b.submit !== false,
      lines: b.lines.map((l: Record<string, unknown>) => ({
        treatedName: String(l.treatedName ?? ""),
        treatment: l.treatment ? String(l.treatment) : undefined,
        treatmentDate: l.treatmentDate ? String(l.treatmentDate) : undefined,
        receiptNo: l.receiptNo ? String(l.receiptNo) : undefined,
        physician: l.physician ? String(l.physician) : undefined,
        hospital: l.hospital ? String(l.hospital) : undefined,
        note: l.note ? String(l.note) : undefined,
        occupationalInjury: Boolean(l.occupationalInjury),
        billAmount: Number(l.billAmount ?? 0),
        reimburseAmount: Number(l.reimburseAmount ?? 0),
        approvedAmount: Number(l.approvedAmount ?? 0),
      })),
    }, actorId);
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — Operation oranHR: submit | return | approve | reject | cancel | settle.
// Settle = jurnal otomatis + saldo used bertambah.
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const actor = readSessionCookie(req);
    const actorId = actor?.uid ?? "system";
    const b = await req.json();
    const actions = ["submit", "return", "approve", "reject", "cancel", "settle"];
    if (!b.id || !actions.includes(b.action)) {
      return NextResponse.json({ error: `id & action (${actions.join("|")}) wajib` }, { status: 400 });
    }
    const res = await decideClaim(db, {
      claimId: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
    }, actorId);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
