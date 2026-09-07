import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { decideRequest } from "@/onevity/leave/services/leave-service";
import { decideTravelRequest } from "@/onevity/travel/services/travel-service";
import { decideClaim } from "@/onevity/medical/services/medical-service";
import { notifyEmailEvent, employeeEmailOf } from "@/onevity/shared/services/email-service";

// POST /api/ess/approvals/decide — putuskan jenjang persetujuan dari ESS.
// Body: { docType: "Leave"|"Travel"|"Medical", docId, action: "approve"|"reject", note? }
// Otorisasi SELEBIH guard sesi: mesin approval memastikan aktor memang
// approver jenjang berjalan (step.approverEmployeeId === employeeId sesi).
export async function POST(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId, actor } = m;

    const b = await req.json().catch(() => ({}));
    const docType = String(b.docType ?? "");
    const docId = String(b.docId ?? "");
    const action = b.action === "reject" ? "reject" : "approve";
    const note = b.note ? String(b.note) : undefined;
    if (!docId || !["Leave", "Travel", "Medical"].includes(docType)) {
      return NextResponse.json({ error: "docType wajib Leave/Travel/Medical + docId" }, { status: 400 });
    }

    const decideActor = { role: actor.role, employeeId, name: actor.name };
    const actorId = actor.appUserId ?? actor.userId;
    let result: { status: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } };

    if (docType === "Leave") {
      result = await decideRequest(db, { id: docId, action, note, actorId, actor: decideActor });
    } else if (docType === "Travel") {
      result = await decideTravelRequest(db, { id: docId, action, note, actorId, actor: decideActor });
    } else {
      const r = await decideClaim(
        db,
        { claimId: docId, action, note, actor: decideActor },
        actorId,
      );
      result = { status: r.state, approval: r.approval };
    }

    // ===== Notifikasi email ke pemohon saat keputusan FINAL (bukan jenjang menengah) =====
    if (!result.approval) {
      void (async () => {
        try {
          let empEmail: string | null = null;
          let event = "";
          const data: Record<string, string> = { catatan: note || "-" };
          if (docType === "Leave") {
            const lr = await db.leaveRequest.findUnique({
              where: { id: docId },
              select: {
                employeeId: true, docNo: true, dateFrom: true, dateTo: true, workingDays: true,
                leaveType: { select: { name: true } }, employee: { select: { fullName: true } },
              },
            });
            if (lr) {
              empEmail = await employeeEmailOf(db, lr.employeeId);
              event = action === "approve" ? "leave.approved" : "leave.rejected";
              Object.assign(data, {
                nama: lr.employee.fullName, docNo: lr.docNo, jenisCuti: lr.leaveType.name,
                periode: `${new Date(lr.dateFrom).toISOString().slice(0, 10)} → ${new Date(lr.dateTo).toISOString().slice(0, 10)}`,
                jumlahHari: String(lr.workingDays),
              });
            }
          } else if (docType === "Travel") {
            const tr = await db.travelRequest.findUnique({
              where: { id: docId },
              select: {
                employeeId: true, docNo: true, dateFrom: true, dateTo: true,
                destinations: { orderBy: { seq: "asc" }, select: { city: true } },
                employee: { select: { fullName: true } },
              },
            });
            if (tr) {
              empEmail = await employeeEmailOf(db, tr.employeeId);
              event = action === "approve" ? "travel.approved" : "travel.rejected";
              Object.assign(data, {
                nama: tr.employee.fullName, docNo: tr.docNo,
                tujuan: tr.destinations.map((d) => d.city).join(", ") || "-",
                biaya: "sesuai klaim",
                periode: `${new Date(tr.dateFrom).toISOString().slice(0, 10)} → ${new Date(tr.dateTo).toISOString().slice(0, 10)}`,
              });
            }
          } else {
            const cl = await db.medicalClaim.findUnique({
              where: { id: docId },
              include: { employee: { select: { fullName: true } }, type: { select: { name: true } } },
            });
            if (cl) {
              empEmail = await employeeEmailOf(db, cl.employeeId);
              event = action === "approve" ? "medical.claim.approved" : "medical.claim.rejected";
              Object.assign(data, {
                nama: cl.employee.fullName, docNo: cl.docNo, jenis: cl.type.name,
                jumlah: `Rp ${(cl.totalApproved ?? cl.totalBill).toLocaleString("id-ID")}`,
              });
            }
          }
          if (empEmail && event) {
            notifyEmailEvent(db, { event, to: [empEmail], data });
          }
        } catch { /* never */ }
      })();
    }

    return NextResponse.json({ ok: true, docType, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
