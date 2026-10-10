import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { tenantSlugOfSession } from "@/rekankerja/shared/api/attachments";
import {
  listPublicApplications, verifyPublicApplication, stagingCvAttachmentId,
} from "@/rekankerja/recruitment/services/applicant-service";

// ============================================================================
// RECRUITMENT F2 — API staging lamaran publik (PublicApplication inbox HR)
// DEVELOPMENT-PLAN-RECRUITMENT.md §7 F2 (D1: verifikasi manual "Upload").
//   GET    ?status=&limit=&offset=   → { rows, total, stats }
//   PATCH  { id, action: verify|reject|spam, note? }  → proses staging
//   GET    ?cv=1&id=                 → { cvAttachmentId } (unduh CV)
// Guard menu: recruitment:public-staging (view + op:verify).
// verify → Applicant (talent pool) + lamaran slot + CV pindah jadi dokumen.
// ============================================================================

// GET /api/rekankerja/recruitment/public-applications
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:public-staging", "recruitment:applicants"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    // sub-permintaan: attachment id CV utk tombol unduh
    if (sp.get("cv") === "1" && sp.get("id")) {
      const cvAttachmentId = await stagingCvAttachmentId(db, sp.get("id")!);
      return NextResponse.json({ cvAttachmentId });
    }

    const mv = await moneyViewForReq(req, db);
    const res = await listPublicApplications(db, {
      status: sp.get("status"),
      limit: Number(sp.get("limit") ?? 50),
      offset: Number(sp.get("offset") ?? 0),
      moneyVisible: mv.canSee,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/rekankerja/recruitment/public-applications — proses staging
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");
    if (action !== "verify" && action !== "reject" && action !== "spam") {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
    const m = await requireMenuAction(req, "recruitment:public-staging", "op:verify");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const slug = await tenantSlugOfSession(req);

    const res = await verifyPublicApplication(db, slug ?? "unknown", {
      id: String(b.id ?? ""),
      action,
      note: b.note ? String(b.note) : null,
      actor: { employeeId: m.actor.employeeId, name: m.actor.name },
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
