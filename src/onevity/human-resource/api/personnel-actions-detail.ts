import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG, type TenantActor } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { applyAssignmentChange, closeCurrentAssignment } from "@/onevity/human-resource/services/assignment";
import { resolveStructuralTargets, PATargetError, type StructuralTargets } from "@/onevity/human-resource/services/pa-targets";

// Error alur kerja dengan status HTTP — dilempar dari dalam $transaction agar
// rollback + dipetakan ke respons yang tepat (409 race / 400 validasi).
class WorkflowError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PRIVILEGED_ROLES = ["OWNER", "ADMIN", "HR"];

/** Guard keputusan (fix K-03): aktor boleh memutus bila berperan OWNER/ADMIN/HR,
 *  ATAU layer menunjuk aktor tersebut, ATAU layer tanpa approver tertentu. */
function canDecideLayer(actor: TenantActor, pending: { approverId: string | null }): boolean {
  if (PRIVILEGED_ROLES.includes(actor.role)) return true;
  if (pending.approverId === null) return true;
  return actor.appUserId != null && pending.approverId === actor.appUserId;
}

// GET detail
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

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

    // aktor sesi (informasional — VIEWER tetap boleh membaca; canAct false)
    const m = await requireMutator(req);
    if (!m.ok && m.status === 401) return NextResponse.json({ error: m.error }, { status: 401 });
    const actor = m.ok ? m.actor : null;
    const pending = action.layers.find((l) => l.status === "Pending") ?? null;
    const canAct =
      !!actor && action.status === "Submitted" && !!pending && canDecideLayer(actor, pending);

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
    return NextResponse.json({
      action: { ...action, employee },
      activities,
      actingUser: actor ? { id: actor.userId, fullName: actor.name, username: actor.appUsername ?? actor.name, role: actor.role } : null,
      canAct,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — workflow transitions: submit|approve|reject|process|cancel|return|update
// Fix K-03: seluruh mutasi lewat requireMutator (VIEWER ditolak; aktor = sesi nyata).
// Fix K-02: efek PA berjalan dalam SATU db.$transaction.
// Fix M-04: transisi memakai update kondisional (updateMany + cek count) → race double-click 409.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // Task 32-d: body dibaca SEKALI sebelum guard (aksi menentukan menu yang dicek):
    // keputusan approve/reject → op:approve menu hr:inbox (per pengguna); aksi
    // lain (submit/process/cancel/return/update) tetap guard sesi+VIEWER.
    const { id } = await ctx.params;
    const b = await req.json();
    const act = b.action as string;
    const note = (b.note as string | undefined)?.trim() || null;

    const m = act === "approve" || act === "reject"
      ? await requireMenuAction(req, "hr:inbox", "op:approve")
      : await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const actorLabel = actor.appUsername ?? actor.name;

    const action = await db.personnelAction.findUnique({
      where: { id },
      include: { layers: { orderBy: { layerNo: "asc" } }, employee: true },
    });
    if (!action) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });

    const log = (msg: string) =>
      db.activityLog.create({
        data: {
          appUserId: actor.appUserId, personnelActionId: id, employeeId: action.employeeId,
          action: act.charAt(0).toUpperCase() + act.slice(1), entity: "PersonnelAction", entityId: id, detail: msg,
        },
      });

    // ============ SUBMIT ============
    if (act === "submit") {
      if (action.status !== "Prepared") return NextResponse.json({ error: "Hanya dokumen Draft yang bisa disubmit" }, { status: 400 });
      // transisi kondisional: hanya berhasil bila status masih Prepared (race → 409)
      const upd = await db.personnelAction.updateMany({
        where: { id, status: "Prepared" },
        data: { status: "Submitted", submittedAt: new Date(), currentLayer: 1 },
      });
      if (upd.count === 0) return NextResponse.json({ error: "Dokumen sudah tidak berstatus Draft (mungkin baru saja disubmit)" }, { status: 409 });
      await log(`${action.docNo} disubmit untuk approval (${action.layers.length} layer) oleh ${actorLabel}`);
      return NextResponse.json({ ok: true, status: "Submitted" });
    }

    // ============ APPROVE / REJECT (acting on current pending layer) ============
    if (act === "approve" || act === "reject") {
      if (action.status !== "Submitted") return NextResponse.json({ error: "Dokumen tidak dalam status Menunggu Approval" }, { status: 400 });
      const pending = action.layers.find((l) => l.status === "Pending");
      if (!pending) return NextResponse.json({ error: "Tidak ada layer approval pending" }, { status: 400 });

      // Guard keputusan berbasis AKTOR SESI (fix K-03 — mengganti cek hard-coded MII000001)
      if (!canDecideLayer(actor, pending)) {
        return NextResponse.json({ error: `Layer ini menunggu persetujuan ${pending.approverRole}` }, { status: 403 });
      }
      // larang self-approve: aktor non-OWNER/ADMIN/HR yang adalah pembuat dokumen
      // tidak boleh memutuskan dokumennya sendiri (maker ≠ checker)
      if (
        !PRIVILEGED_ROLES.includes(actor.role) &&
        action.createdBy &&
        (action.createdBy === actor.appUsername || action.createdBy === actor.name)
      ) {
        return NextResponse.json(
          { error: "Pembuat dokumen tidak boleh menyetujui/menolak dokumennya sendiri (pemisahan maker-checker)" },
          { status: 403 },
        );
      }

      const isLast = pending.layerNo >= action.layers.length;
      const decision = act === "approve" ? "Approved" : "Rejected";

      // Transisi dalam SATU transaksi + kondisi status (fix M-04):
      // layer hanya bisa diputuskan sekali (status Pending), PA harus masih Submitted.
      await db.$transaction(async (tx) => {
        const layerUpd = await tx.approvalLayer.updateMany({
          where: { id: pending.id, status: "Pending" },
          data: { status: decision, note, decidedAt: new Date(), approverId: actor.appUserId ?? pending.approverId },
        });
        if (layerUpd.count === 0) throw new WorkflowError(409, "Layer ini sudah diputuskan sebelumnya (dokumen mungkin baru saja diproses)");

        if (act === "reject") {
          const paUpd = await tx.personnelAction.updateMany({ where: { id, status: "Submitted" }, data: { status: "Rejected" } });
          if (paUpd.count === 0) throw new WorkflowError(409, "Dokumen sudah tidak menunggu approval");
        } else if (isLast) {
          const paUpd = await tx.personnelAction.updateMany({
            where: { id, status: "Submitted" },
            data: { status: "Approved", currentLayer: action.layers.length },
          });
          if (paUpd.count === 0) throw new WorkflowError(409, "Dokumen sudah tidak menunggu approval");
        } else {
          const paUpd = await tx.personnelAction.updateMany({
            where: { id, status: "Submitted" },
            data: { currentLayer: pending.layerNo + 1 },
          });
          if (paUpd.count === 0) throw new WorkflowError(409, "Dokumen sudah tidak menunggu approval");
        }
      });

      if (act === "reject") {
        await log(`${action.docNo} DITOLAK di layer ${pending.layerNo} (${pending.approverRole}) oleh ${actorLabel}${note ? ` — alasan: ${note}` : ""}`);
        return NextResponse.json({ ok: true, status: "Rejected" });
      }
      if (isLast) {
        await log(`${action.docNo} disetujui di layer terakhir oleh ${actorLabel} (${pending.approverRole}) — siap diproses`);
        return NextResponse.json({ ok: true, status: "Approved" });
      }
      await log(`Layer ${pending.layerNo} (${pending.approverRole}) disetujui ${actorLabel} — ${action.docNo} lanjut layer ${pending.layerNo + 1}`);
      return NextResponse.json({ ok: true, status: "Submitted" });
    }

    // ============ PROCESS (apply side effects → riwayat pekerjaan) ============
    if (act === "process") {
      if (action.status === "Processed") return NextResponse.json({ error: "Dokumen sudah diproses sebelumnya" }, { status: 409 });
      if (action.status !== "Approved") return NextResponse.json({ error: "Hanya dokumen Disetujui yang bisa diproses" }, { status: 400 });

      const detail = action.detailJson ? (JSON.parse(action.detailJson) as Record<string, string | number | null>) : {};
      const effectiveDate = action.effectiveDate ?? new Date();

      const isStructural = action.type === "Promotion" || action.type === "Demotion" || action.type === "Transfer" || action.type === "Mutation";
      const isTermination = action.type === "Resignation" || action.type === "Termination" || action.type === "Retirement";
      const isRenewal = action.type === "ExtendProbation" || action.type === "ContractRenewal";

      // Fix K-01: resolve target struktural — kontrak baru (ID) + fallback kode lama
      // (data PA demo/seed). PA struktural tanpa target valid → error jelas, bukan no-op.
      let targets: StructuralTargets = {};
      if (isStructural) {
        targets = await resolveStructuralTargets(db, detail, { requireTarget: true });
      }

      // pastikan karyawan masih punya penempatan aktif (efek non-terminasi butuh itu)
      if (isStructural || action.type === "SalaryAdjustment" || action.type === "ChangeStatus" || isRenewal) {
        const cur = await db.employeeAssignment.findFirst({
          where: { employeeId: action.employeeId, validTo: null },
          orderBy: { validFrom: "desc" },
          select: { id: true },
        });
        if (!cur) return NextResponse.json({ error: "Karyawan tidak memiliki penempatan aktif" }, { status: 400 });
      }

      // Fix K-02: seluruh side-effect + perubahan status PA dalam SATU transaksi —
      // kegagalan di tengah tidak meninggalkan assignment tertutup tanpa pengganti /
      // status berubah tanpa jejak; PA hanya menjadi Processed bila semua efek berhasil.
      await db.$transaction(async (tx) => {
        if (isStructural) {
          await applyAssignmentChange(
            tx,
            action.employeeId,
            {
              positionId: targets.positionId,
              orgUnitId: targets.orgUnitId,
              gradeId: targets.gradeId,
              baseSalary: detail.newSalary ? Number(detail.newSalary) : undefined,
            },
            { reason: action.type, effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
          );
        } else if (action.type === "SalaryAdjustment" && detail.newSalary) {
          await applyAssignmentChange(
            tx,
            action.employeeId,
            { baseSalary: Number(detail.newSalary) },
            { reason: "SalaryAdjustment", effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
          );
        } else if (action.type === "ChangeStatus" && detail.newEmploymentStatus) {
          await applyAssignmentChange(
            tx,
            action.employeeId,
            { employmentStatus: String(detail.newEmploymentStatus) },
            { reason: "ChangeStatus", effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
          );
        } else if (isRenewal) {
          await applyAssignmentChange(
            tx,
            action.employeeId,
            { employmentStatus: detail.newEmploymentStatus ? String(detail.newEmploymentStatus) : undefined },
            { reason: action.type, effectiveDate, sourceDocNo: action.docNo, notes: action.reason ?? null },
          );
        } else if (isTermination) {
          // Fix M-02: tanggal akhir = detail.lastDay (bila diisi) — bukan effectiveDate.
          const endDate = detail.lastDay ? new Date(String(detail.lastDay)) : effectiveDate;
          const exitStatus = action.type === "Resignation" ? "Resigned" : action.type === "Termination" ? "Terminated" : "Resigned";
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          if (endDate.getTime() <= todayStart.getTime()) {
            await tx.employee.update({ where: { id: action.employeeId }, data: { status: exitStatus, endDate } });
          } else {
            // Resign terjadwal: assignment ditutup pada endDate, status karyawan JANGAN
            // dinonaktifkan dulu — karyawan masih aktif sampai hari terakhirnya
            // (status baru dinonaktifkan bila endDate ≤ hari ini; jalur itu di atas).
            await tx.employee.update({ where: { id: action.employeeId }, data: { endDate } });
          }
          // tutup assignment aktif pada tanggal akhir kerja
          await closeCurrentAssignment(tx, action.employeeId, endDate);
        }

        // status PA berubah menjadi Processed hanya di DALAM transaksi, dengan kondisi
        // status Approved (idempoten + aman terhadap proses ganda paralel → 409).
        const upd = await tx.personnelAction.updateMany({
          where: { id, status: "Approved" },
          data: { status: "Processed", processedAt: new Date() },
        });
        if (upd.count === 0) throw new WorkflowError(409, "Dokumen sudah diproses sebelumnya");
      });

      await log(`${action.docNo} DIPROSES oleh ${actorLabel} — perubahan diterapkan & tercatat di riwayat pekerjaan (${action.type})`);
      return NextResponse.json({ ok: true, status: "Processed" });
    }

    // ============ CANCEL ============
    if (act === "cancel") {
      if (action.status === "Processed") return NextResponse.json({ error: "Dokumen sudah diproses, tidak bisa dibatalkan" }, { status: 400 });
      const upd = await db.personnelAction.updateMany({
        where: { id, status: { not: "Processed" } },
        data: { status: "Cancelled" },
      });
      if (upd.count === 0) return NextResponse.json({ error: "Dokumen sudah diproses, tidak bisa dibatalkan" }, { status: 409 });
      await log(`${action.docNo} dibatalkan oleh ${actorLabel}`);
      return NextResponse.json({ ok: true, status: "Cancelled" });
    }

    // ============ RETURN TO DRAFT ============
    if (act === "return") {
      if (!["Rejected", "Cancelled"].includes(action.status)) return NextResponse.json({ error: "Hanya dokumen Ditolak/Dibatalkan yang bisa dikembalikan ke draft" }, { status: 400 });
      await db.$transaction(async (tx) => {
        await tx.approvalLayer.updateMany({ where: { personnelActionId: id }, data: { status: "Pending", note: null, decidedAt: null } });
        const upd = await tx.personnelAction.updateMany({
          where: { id, status: { in: ["Rejected", "Cancelled"] } },
          data: { status: "Prepared", currentLayer: 0, submittedAt: null },
        });
        if (upd.count === 0) throw new WorkflowError(409, "Status dokumen sudah berubah — muat ulang halaman");
      });
      await log(`${action.docNo} dikembalikan ke draft untuk revisi oleh ${actorLabel}`);
      return NextResponse.json({ ok: true, status: "Prepared" });
    }

    // ============ UPDATE (edit draft) ============
    if (act === "update") {
      if (action.status !== "Prepared") return NextResponse.json({ error: "Hanya draft yang bisa diedit" }, { status: 400 });
      // validasi tanggal efektif draft (M-05): tidak boleh mendahului joinDate karyawan
      if (b.effectiveDate) {
        const eff = new Date(b.effectiveDate);
        if (Number.isNaN(eff.getTime())) return NextResponse.json({ error: "Tanggal efektif tidak valid" }, { status: 400 });
        if (eff.getTime() < action.employee.joinDate.getTime()) {
          return NextResponse.json(
            { error: `Tanggal efektif (${eff.toISOString().slice(0, 10)}) tidak boleh mendahului tanggal bergabung karyawan (${action.employee.joinDate.toISOString().slice(0, 10)})` },
            { status: 400 },
          );
        }
      }
      await db.personnelAction.update({
        where: { id },
        data: {
          reason: b.reason ?? action.reason,
          effectiveDate: b.effectiveDate ? new Date(b.effectiveDate) : undefined,
          detailJson: b.detail ? JSON.stringify(b.detail) : action.detailJson,
        },
      });
      await log(`Draft ${action.docNo} diedit oleh ${actorLabel}`);
      return NextResponse.json({ ok: true, status: "Prepared" });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${act}` }, { status: 400 });
  } catch (e) {
    if (e instanceof WorkflowError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof PATargetError) return NextResponse.json({ error: e.message }, { status: 400 });
    // FK prisma tidak valid (P2003) → 400 pesan ramah, bukan 500
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa posisi/unit/grade tujuan" }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE draft only
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db } = m;

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
