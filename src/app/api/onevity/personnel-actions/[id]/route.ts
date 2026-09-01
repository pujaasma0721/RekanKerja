import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyAssignmentChange, closeCurrentAssignment } from "@/lib/onevity/assignment";

// GET detail
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const action = await db.personnelAction.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true, fullName: true, employeeNo: true, status: true, joinDate: true, endDate: true,
            // data pekerjaan saat ini dari assignment aktif
            assignments: {
              where: { validTo: null },
              orderBy: { validFrom: "desc" },
              take: 1,
              include: {
                position: { select: { id: true, title: true, code: true } },
                orgUnit: { select: { id: true, name: true, code: true } },
                grade: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
        layers: { orderBy: { layerNo: "asc" }, include: { approver: { select: { id: true, fullName: true, role: true, username: true } } } },
      },
    });
    if (!action) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });

    // flatten assignment aktif → bentuk lama (employmentStatus/baseSalary/workShift/position/…)
    const emp = action.employee as typeof action.employee & { assignments?: unknown[] };
    const cur = (emp.assignments as { employmentStatus: string; workShift: string; baseSalary: number; position: unknown; orgUnit: unknown; grade: unknown }[] | undefined)?.[0];
    const { assignments: _a, ...empRest } = emp as Record<string, unknown>;
    const employee = {
      ...empRest,
      employmentStatus: cur?.employmentStatus ?? "—",
      baseSalary: cur?.baseSalary ?? 0,
      workShift: cur?.workShift ?? "—",
      position: cur?.position ?? null,
      orgUnit: cur?.orgUnit ?? null,
      grade: cur?.grade ?? null,
    };

    const activities = await db.activityLog.findMany({
      where: { personnelActionId: id },
      include: { appUser: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ action: { ...action, employee }, activities });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — workflow transitions: submit|approve|reject|process|cancel|return
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await req.json();
    const act = b.action as string;
    const note = (b.note as string | undefined)?.trim() || null;
    const me = await db.appUser.findFirst({ where: { username: "MII000001" } });

    const action = await db.personnelAction.findUnique({
      where: { id },
      include: { layers: { orderBy: { layerNo: "asc" } }, employee: true },
    });
    if (!action) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });

    const log = (msg: string) =>
      db.activityLog.create({
        data: {
          appUserId: me?.id ?? null, personnelActionId: id, employeeId: action.employeeId,
          action: act.charAt(0).toUpperCase() + act.slice(1), entity: "PersonnelAction", entityId: id, detail: msg,
        },
      });

    // ============ SUBMIT ============
    if (act === "submit") {
      if (action.status !== "Prepared") return NextResponse.json({ error: "Hanya dokumen Draft yang bisa disubmit" }, { status: 400 });
      await db.personnelAction.update({ where: { id }, data: { status: "Submitted", submittedAt: new Date(), currentLayer: 1 } });
      await log(`${action.docNo} disubmit untuk approval (${action.layers.length} layer)`);
      return NextResponse.json({ ok: true, status: "Submitted" });
    }

    // ============ APPROVE / REJECT (acting on current pending layer) ============
    if (act === "approve" || act === "reject") {
      if (action.status !== "Submitted") return NextResponse.json({ error: "Dokumen tidak dalam status Menunggu Approval" }, { status: 400 });
      const pending = action.layers.find((l) => l.status === "Pending");
      if (!pending) return NextResponse.json({ error: "Tidak ada layer approval pending" }, { status: 400 });
      if (me && pending.approverId && pending.approverId !== me.id) {
        // acting user is not the designated approver — allow only if they are HR Manager role
        const approver = await db.appUser.findUnique({ where: { id: pending.approverId } });
        if (approver?.role !== "HR Manager" && me.role !== "Admin") {
          return NextResponse.json({ error: `Layer ini menunggu persetujuan ${pending.approverRole}` }, { status: 403 });
        }
      }

      if (act === "reject") {
        await db.approvalLayer.update({
          where: { id: pending.id },
          data: { status: "Rejected", note, decidedAt: new Date(), approverId: me?.id ?? pending.approverId },
        });
        await db.personnelAction.update({ where: { id }, data: { status: "Rejected" } });
        await log(`${action.docNo} DITOLAK di layer ${pending.layerNo} (${pending.approverRole})${note ? ` — alasan: ${note}` : ""}`);
        return NextResponse.json({ ok: true, status: "Rejected" });
      }

      // approve this layer
      await db.approvalLayer.update({
        where: { id: pending.id },
        data: { status: "Approved", note, decidedAt: new Date(), approverId: me?.id ?? pending.approverId },
      });
      const isLast = pending.layerNo >= action.layers.length;
      if (isLast) {
        await db.personnelAction.update({ where: { id }, data: { status: "Approved", currentLayer: action.layers.length } });
        await log(`${action.docNo} disetujui di layer terakhir — siap diproses`);
        return NextResponse.json({ ok: true, status: "Approved" });
      }
      await db.personnelAction.update({ where: { id }, data: { currentLayer: pending.layerNo + 1 } });
      await log(`Layer ${pending.layerNo} (${pending.approverRole}) menyetujui ${action.docNo} — lanjut layer ${pending.layerNo + 1}`);
      return NextResponse.json({ ok: true, status: "Submitted" });
    }

    // ============ PROCESS (apply side effects → riwayat pekerjaan) ============
    if (act === "process") {
      if (action.status !== "Approved") return NextResponse.json({ error: "Hanya dokumen Disetujui yang bisa diproses" }, { status: 400 });
      const detail = action.detailJson ? (JSON.parse(action.detailJson) as Record<string, string | number | null>) : {};
      const effectiveDate = action.effectiveDate ?? new Date();

      // side effects per type — perubahan pekerjaan tercatat sebagai baris riwayat baru
      if (action.type === "Promotion" || action.type === "Demotion" || action.type === "Transfer" || action.type === "Mutation") {
        await applyAssignmentChange(
          action.employeeId,
          {
            positionId: detail.positionId ? String(detail.positionId) : undefined,
            orgUnitId: detail.orgUnitId ? String(detail.orgUnitId) : undefined,
            gradeId: detail.gradeId ? String(detail.gradeId) : undefined,
            baseSalary: detail.newSalary ? Number(detail.newSalary) : undefined,
          },
          { reason: action.type, effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
        );
      } else if (action.type === "SalaryAdjustment" && detail.newSalary) {
        await applyAssignmentChange(
          action.employeeId,
          { baseSalary: Number(detail.newSalary) },
          { reason: "SalaryAdjustment", effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
        );
      } else if (action.type === "ChangeStatus" && detail.newEmploymentStatus) {
        await applyAssignmentChange(
          action.employeeId,
          { employmentStatus: String(detail.newEmploymentStatus) },
          { reason: "ChangeStatus", effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
        );
      } else if (action.type === "ExtendProbation" || action.type === "ContractRenewal") {
        await applyAssignmentChange(
          action.employeeId,
          { employmentStatus: detail.newEmploymentStatus ? String(detail.newEmploymentStatus) : undefined },
          { reason: action.type, effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
        );
      } else if (action.type === "Resignation" || action.type === "Termination" || action.type === "Retirement") {
        await db.employee.update({
          where: { id: action.employeeId },
          data: {
            status: action.type === "Resignation" ? "Resigned" : action.type === "Termination" ? "Terminated" : "Resigned",
            endDate: action.effectiveDate,
          },
        });
        // tutup assignment aktif pada tanggal efektif
        await closeCurrentAssignment(action.employeeId, effectiveDate);
      }

      await db.personnelAction.update({ where: { id }, data: { status: "Processed", processedAt: new Date() } });
      await log(`${action.docNo} DIPROSES — perubahan diterapkan & tercatat di riwayat pekerjaan (${action.type})`);
      return NextResponse.json({ ok: true, status: "Processed" });
    }

    // ============ CANCEL ============
    if (act === "cancel") {
      if (["Processed"].includes(action.status)) return NextResponse.json({ error: "Dokumen sudah diproses, tidak bisa dibatalkan" }, { status: 400 });
      await db.personnelAction.update({ where: { id }, data: { status: "Cancelled" } });
      await log(`${action.docNo} dibatalkan`);
      return NextResponse.json({ ok: true, status: "Cancelled" });
    }

    // ============ RETURN TO DRAFT ============
    if (act === "return") {
      if (!["Rejected", "Cancelled"].includes(action.status)) return NextResponse.json({ error: "Hanya dokumen Ditolak/Dibatalkan yang bisa dikembalikan ke draft" }, { status: 400 });
      // reset layers
      await db.approvalLayer.updateMany({ where: { personnelActionId: id }, data: { status: "Pending", note: null, decidedAt: null } });
      await db.personnelAction.update({ where: { id }, data: { status: "Prepared", currentLayer: 0, submittedAt: null } });
      await log(`${action.docNo} dikembalikan ke draft untuk revisi`);
      return NextResponse.json({ ok: true, status: "Prepared" });
    }

    // ============ UPDATE (edit draft) ============
    if (act === "update") {
      if (action.status !== "Prepared") return NextResponse.json({ error: "Hanya draft yang bisa diedit" }, { status: 400 });
      await db.personnelAction.update({
        where: { id },
        data: {
          reason: b.reason ?? action.reason,
          effectiveDate: b.effectiveDate ? new Date(b.effectiveDate) : undefined,
          detailJson: b.detail ? JSON.stringify(b.detail) : action.detailJson,
        },
      });
      await log(`Draft ${action.docNo} diedit`);
      return NextResponse.json({ ok: true, status: "Prepared" });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${act}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE draft only
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const action = await db.personnelAction.findUnique({ where: { id } });
    if (!action) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });
    if (action.status !== "Prepared" && action.status !== "Cancelled") {
      return NextResponse.json({ error: "Hanya dokumen Draft/Dibatalkan yang bisa dihapus" }, { status: 400 });
    }
    await db.personnelAction.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
