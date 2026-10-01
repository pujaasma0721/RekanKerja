import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG, type TenantActor, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { applyAssignmentChange, closeCurrentAssignment, applyWageTemplateChange } from "@/rekankerja/human-resource/services/assignment";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import { resolveStructuralTargets, PATargetError, type StructuralTargets } from "@/rekankerja/human-resource/services/pa-targets";
import { findActiveDelegation } from "@/rekankerja/shared/services/approval-engine";
import { applyTerminationSettlement } from "@/rekankerja/payroll/services/settlement-service";
import { createOffboardingWithTasks, DEFAULT_OFFBOARDING_TASKS } from "@/rekankerja/human-resource/api/offboarding";

// Error alur kerja dengan status HTTP — dilempar dari dalam $transaction agar
// rollback + dipetakan ke respons yang tepat (409 race / 400 validasi).
class WorkflowError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PRIVILEGED_ROLES = ["OWNER", "ADMIN", "HR"];

// Label Indonesia jenis Personnel Action (dipakai data notifikasi email).
const PA_TYPE_LABEL: Record<string, string> = {
  Hire: "Pengangkatan", Promotion: "Promosi", Demotion: "Demosi", Transfer: "Transfer",
  Mutation: "Mutasi", SalaryAdjustment: "Penyesuaian Upah", ContractRenewal: "Perpanjangan Kontrak",
  ChangeStatus: "Perubahan Status", ExtendProbation: "Perpanjangan Probation",
  Resignation: "Pengunduran Diri", Termination: "Pemutusan Hubungan Kerja", Retirement: "Pensiun",
};
const paTypeLabel = (t: string): string => PA_TYPE_LABEL[t] ?? t;
const paDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Guard keputusan (fix K-03): aktor boleh memutus bila berperan OWNER/ADMIN/HR,
 *  ATAU layer menunjuk aktor tersebut, ATAU layer tanpa approver tertentu,
 *  ATAU aktor adalah delegate aktif (TemporaryApprover, docType
 *  PersonnelAction) dari approver layer — delegasi kini DIEKSEKUSI engine.
 *  Return delegatedFrom (nama approver asal) untuk jejak "(delegasi dari X)". */
async function canDecideLayer(
  db: TenantDb,
  actor: TenantActor,
  pending: { approverId: string | null },
): Promise<{ allowed: boolean; delegatedFrom: string | null }> {
  if (PRIVILEGED_ROLES.includes(actor.role)) return { allowed: true, delegatedFrom: null };
  if (pending.approverId === null) return { allowed: true, delegatedFrom: null };
  if (actor.appUserId != null && pending.approverId === actor.appUserId) {
    return { allowed: true, delegatedFrom: null };
  }
  const delegatedFrom = actor.appUserId != null
    ? await findActiveDelegation(
        db,
        "PersonnelAction",
        { appUserId: actor.appUserId, employeeId: actor.employeeId },
        { appUserId: pending.approverId },
      )
    : null;
  return { allowed: delegatedFrom != null, delegatedFrom };
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
    const layerAuthz = actor && pending ? await canDecideLayer(db, actor, pending) : { allowed: false, delegatedFrom: null };
    const canAct = !!actor && action.status === "Submitted" && !!pending && layerAuthz.allowed;

    // flatten assignment aktif → bentuk lama (employmentStatus/baseSalary/workShift/position/…)
    // 45-b: baseSalary display digate vault; resolve via sesi (route ini
    // requireTenant; requireMutator berikut hanya informasional).
    // 56: dec0 — vault tertutup → 0 (konsisten gate uang UI admin payroll).
    const emp = action.employee as typeof action.employee & { assignments?: unknown[] };
    const cur = (emp.assignments as { employmentStatus: string; workShift: string; baseSalary: string | null; position: unknown; orgUnit: unknown; grade: unknown }[] | undefined)?.[0];
    const { assignments: _a, ...empRest } = emp as Record<string, unknown>;
    const mv = await moneyViewForReq(req, db);
    const employee = {
      ...empRest,
      employmentStatus: cur?.employmentStatus ?? "—",
      // 28-c: baseSalary terenkripsi — dekripsi di batas serializer (gate 45-b).
      baseSalary: cur ? mv.dec0(cur.baseSalary) : 0,
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

      // ===== Notifikasi email otomatis (Task 34) — ke approver layer aktif =====
      void (async () => {
        try {
          const layer = action.layers[0];
          let to: { email: string; name?: string }[] = [];
          let approverName = layer?.approverRole ?? "Approver";
          if (layer?.approverId) {
            const au = await db.appUser.findUnique({ where: { id: layer.approverId }, select: { email: true, fullName: true } });
            if (au?.email) {
              to = [{ email: au.email, name: au.fullName ?? undefined }];
              approverName = au.fullName ?? approverName;
            }
          }
          if (to.length === 0) to = await approverEmailsOf(db, action.employeeId);
          if (to.length === 0) return;
          notifyEmailEvent(db, {
            event: "pa.submitted",
            to,
            data: {
              nama: action.employee.fullName ?? "-", docNo: action.docNo, jenisAksi: paTypeLabel(action.type),
              tanggalEfektif: paDate(action.effectiveDate), alasan: action.reason ?? "-",
              layer: layer?.approverRole ?? "-", approver: approverName,
            },
          });
        } catch { /* notifikasi tidak pernah mengganggu proses utama */ }
      })();
      return NextResponse.json({ ok: true, status: "Submitted" });
    }

    // ============ APPROVE / REJECT (acting on current pending layer) ============
    if (act === "approve" || act === "reject") {
      if (action.status !== "Submitted") return NextResponse.json({ error: "Dokumen tidak dalam status Menunggu Approval" }, { status: 400 });
      const pending = action.layers.find((l) => l.status === "Pending");
      if (!pending) return NextResponse.json({ error: "Tidak ada layer approval pending" }, { status: 400 });

      // Guard keputusan berbasis AKTOR SESI (fix K-03 — mengganti cek hard-coded MII000001)
      // + delegasi aktif TemporaryApprover (Settings → Temporary Approver).
      const layerAuthz = await canDecideLayer(db, actor, pending);
      if (!layerAuthz.allowed) {
        return NextResponse.json({ error: `Layer ini menunggu persetujuan ${pending.approverRole}` }, { status: 403 });
      }
      // jejak delegasi pada note layer + activity log (free-text, aman konsumen lama)
      const delegatedSuffix = layerAuthz.delegatedFrom ? ` (delegasi dari ${layerAuthz.delegatedFrom})` : "";
      const layerNote = layerAuthz.delegatedFrom && note ? `${note}${delegatedSuffix}` : note;
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
          data: { status: decision, note: layerNote, decidedAt: new Date(), approverId: actor.appUserId ?? pending.approverId },
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
        await log(`${action.docNo} DITOLAK di layer ${pending.layerNo} (${pending.approverRole}) oleh ${actorLabel}${delegatedSuffix}${note ? ` — alasan: ${note}` : ""}`);

        // ===== Notifikasi email — keputusan final DITOLAK ke karyawan =====
        void (async () => {
          try {
            const emp = action.employee;
            if (!emp.email) return;
            notifyEmailEvent(db, {
              event: "pa.rejected",
              to: [{ email: emp.email, name: emp.fullName ?? undefined }],
              data: {
                nama: emp.fullName ?? "-", docNo: action.docNo, jenisAksi: paTypeLabel(action.type),
                tanggalEfektif: paDate(action.effectiveDate), catatan: note ?? "-",
              },
            });
          } catch { /* never */ }
        })();
        return NextResponse.json({ ok: true, status: "Rejected" });
      }
      if (isLast) {
        await log(`${action.docNo} disetujui di layer terakhir oleh ${actorLabel}${delegatedSuffix} (${pending.approverRole}) — siap diproses`);

        // ===== Notifikasi email — DISETUJUI (layer terakhir) ke karyawan =====
        void (async () => {
          try {
            const emp = action.employee;
            if (!emp.email) return;
            notifyEmailEvent(db, {
              event: "pa.approved",
              to: [{ email: emp.email, name: emp.fullName ?? undefined }],
              data: {
                nama: emp.fullName ?? "-", docNo: action.docNo, jenisAksi: paTypeLabel(action.type),
                tanggalEfektif: paDate(action.effectiveDate), catatan: note ?? "-",
              },
            });
          } catch { /* never */ }
        })();
        return NextResponse.json({ ok: true, status: "Approved" });
      }
      await log(`Layer ${pending.layerNo} (${pending.approverRole}) disetujui ${actorLabel}${delegatedSuffix} — ${action.docNo} lanjut layer ${pending.layerNo + 1}`);
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

      // ===== Task 52-g — BLOKIR PKWT > 5 TAHUN (PP 35/2021 Ps.8) =====
      // PKWT + seluruh perpanjangannya maks 5 tahun; lebih dari itu WAJIB
      // konversi PKS. Sebelumnya hanya warning banner (edukatif). Kini proses
      // perpanjangan DITOLAK 409 (code PKWT_OVER_5Y) bila contractStart pertama
      // → contractEnd baru > 60 bulan. Override eksplisit b.force === true
      // (HR menyadari pelanggaran — dicatat sebagai ActivityLog Warning).
      let pkwtForceNote = "";
      if (action.type === "ContractRenewal") {
        const empPkwt = await db.employee.findUnique({
          where: { id: action.employeeId },
          select: { joinDate: true, contractStart: true, contractEnd: true },
        });
        if (empPkwt) {
          const months = detail.months ? Number(detail.months) : null;
          let newEnd = detail.newEndDate ? new Date(String(detail.newEndDate)) : null;
          if (!newEnd && months && empPkwt.contractEnd) {
            newEnd = new Date(empPkwt.contractEnd);
            newEnd.setMonth(newEnd.getMonth() + months);
          }
          if (newEnd) {
            const startRef = empPkwt.contractStart ? new Date(empPkwt.contractStart) : new Date(empPkwt.joinDate);
            let totalMonths = (newEnd.getFullYear() - startRef.getFullYear()) * 12 + (newEnd.getMonth() - startRef.getMonth());
            if (newEnd.getDate() < startRef.getDate()) totalMonths -= 1;
            if (totalMonths > 60 && b.force !== true) {
              return NextResponse.json(
                {
                  error: `Total durasi PKWT akan menjadi ${Math.floor(totalMonths / 12)} tahun ${totalMonths % 12} bulan — melebihi batas 5 tahun (PP 35/2021 Ps.8). WAJIB konversi ke PKS (PA ChangeStatus → Permanent). Bila tetap dipaksa, kirim force=true dengan kesadaran risiko hubungan kerja menjadi PKS demi hukum.`,
                  code: "PKWT_OVER_5Y",
                },
                { status: 409 },
              );
            }
            if (totalMonths > 60 && b.force === true) {
              pkwtForceNote = ` — DIPAKSA melampaui 5 tahun (${Math.floor(totalMonths / 12)} th ${totalMonths % 12} bln) oleh ${actorLabel}: risiko otomatis menjadi PKS (PP 35/2021 Ps.8)`;
            }
          }
        }
      }

      // Fix K-02: seluruh side-effect + perubahan status PA dalam SATU transaksi —
      // kegagalan di tengah tidak meninggalkan assignment tertutup tanpa pengganti /
      // status berubah tanpa jejak; PA hanya menjadi Processed bila semua efek berhasil.
      // 26-b: pkwtNote diisi blok PKWT di dalam transaksi → dilekatkan ke log proses.
      let pkwtNote = "";
      await db.$transaction(async (tx) => {
        if (isStructural) {
          await applyAssignmentChange(
            tx,
            action.employeeId,
            {
              positionId: targets.positionId,
              orgUnitId: targets.orgUnitId,
              gradeId: targets.gradeId,
              // Task 64 — pindah office/lokasi via PA (Transfer/Mutation):
              // perubahan efektif mencipta segmen prorate di run payroll.
              companyOfficeId: detail.companyOfficeId ? String(detail.companyOfficeId) : undefined,
              workLocationId: detail.workLocationId ? String(detail.workLocationId) : undefined,
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

        // Task 64 — perubahan template upah via PA (promosi/mutasi/kenaikan
        // jabatan sering mengubah paket komponen upah): tulis riwayat
        // effective-dated — run payroll membaca versi BERLAKU pada period.
        if (!isTermination && detail.newWageTemplateId !== undefined) {
          await applyWageTemplateChange(
            tx,
            action.employeeId,
            detail.newWageTemplateId ? String(detail.newWageTemplateId) : null,
            { effectiveDate, reason: action.type, sourceDocNo: action.docNo, notes: action.reason ?? null },
          );
        }

        // ===== 26-b P0 — aritmetika kontrak PKWT (PP 35/2021) =====
        // CONTRACTRENEWAL → renewalCount +1 dan geser contractEnd (newEndDate
        // PA bila ada, else contractEnd lama + months). contractStart dipertahankan
        // sebagai tanggal mulai PKWT PERTAMA (basis hitung durasi total 5 tahun).
        // CHANGESTATUS → jadi Permanent = konversi PKS: kosongkan jejak PKWT;
        // berubah ke Contract/Probation & belum ada start → set dari effectiveDate.
        if (action.type === "ContractRenewal") {
          const emp = await tx.employee.findUnique({
            where: { id: action.employeeId },
            select: { contractStart: true, contractEnd: true, renewalCount: true },
          });
          if (emp) {
            const months = detail.months ? Number(detail.months) : null;
            let newEnd = detail.newEndDate ? new Date(String(detail.newEndDate)) : null;
            if (!newEnd && months && emp.contractEnd) {
              newEnd = new Date(emp.contractEnd);
              newEnd.setMonth(newEnd.getMonth() + months);
            }
            const renewals = (emp.renewalCount ?? 0) + 1;
            await tx.employee.update({
              where: { id: action.employeeId },
              data: {
                renewalCount: renewals,
                ...(newEnd ? { contractEnd: newEnd } : {}),
              },
            });
            pkwtNote = ` — perpanjangan PKWT ke-${renewals + 1}${newEnd ? `, kontrak berakhir ${paDate(newEnd)}` : ""}`;
          }
        } else if (action.type === "ChangeStatus" && detail.newEmploymentStatus) {
          const newStatus = String(detail.newEmploymentStatus);
          if (newStatus === "Permanent") {
            await tx.employee.update({
              where: { id: action.employeeId },
              data: { contractStart: null, contractEnd: null, renewalCount: 0 },
            });
            pkwtNote = " — konversi ke PKS: jejak PKWT dikosongkan (PP 35/2021 Pasal 8)";
          } else {
            const emp = await tx.employee.findUnique({
              where: { id: action.employeeId },
              select: { contractStart: true },
            });
            if (emp && !emp.contractStart) {
              await tx.employee.update({
                where: { id: action.employeeId },
                data: { contractStart: effectiveDate },
              });
            }
          }
        }

        // status PA berubah menjadi Processed hanya di DALAM transaksi, dengan kondisi
        // status Approved (idempoten + aman terhadap proses ganda paralel → 409).
        const upd = await tx.personnelAction.updateMany({
          where: { id, status: "Approved" },
          data: { status: "Processed", processedAt: new Date() },
        });
        if (upd.count === 0) throw new WorkflowError(409, "Dokumen sudah diproses sebelumnya");
      });

      await log(`${action.docNo} DIPROSES oleh ${actorLabel} — perubahan diterapkan & tercatat di riwayat pekerjaan (${action.type})${pkwtNote}${pkwtForceNote}`);

      // ===== T19: Final Settlement PHK — best-effort, SETELAH status karyawan =====
      // berubah (transaksi di atas sudah commit). Kegagalan settlement TIDAK
      // memblokir proses PA: error ditangkap + dicatat sebagai ActivityLog —
      // HR dapat mengulang perhitungan settlement manual.
      // Fix audit 40 K-2(b) — settlement kini dibuat untuk SEMUA jenis PA
      // pengakhiran: Termination (pesangon + UPMK + uang pisah + THR prorata +
      // penggantian hak) DAN Resignation/Retirement (exitKind "resignation" —
      // HANYA Penggantian Hak UU 13/2003 Ps.156(2)(c): uang cuti (rule-aware
      // M-5) + pengurang pinjaman + PPh final; TANPA pesangon/uang pisah/THR).
      // Upah bulan terakhir TIDAK masuk settlement (semua jenis) — dibayar via
      // run SALARY bulan berjalan (fix K-2(a) payroll-service buildRunRows:
      // leaver tetap masuk run dgn prorate s.d. lastDay).
      let settlement: Awaited<ReturnType<typeof applyTerminationSettlement>> | null = null;
      if (isTermination) {
        const settlementDate = detail.lastDay ? new Date(String(detail.lastDay)) : effectiveDate;
        try {
          settlement = await applyTerminationSettlement(db, {
            employeeId: action.employeeId,
            effectiveDate: Number.isNaN(settlementDate.getTime()) ? effectiveDate : settlementDate,
            params: detail,
            paDocNo: action.docNo,
            paId: id,
            actor: { appUserId: actor.appUserId, name: actorLabel },
            // Fix audit 40 K-2(b) — jenis pengakhiran: Resignation/Retirement →
            // settlement Penggantian Hak (tanpa pesangon/UPMK/uang pisah/THR).
            exitKind: action.type === "Termination" ? "termination" : "resignation",
          });
        } catch (se) {
          const msg = se instanceof Error ? se.message : "unknown";
          try {
            await db.activityLog.create({
              data: {
                action: "Error", entity: "PersonnelAction", entityId: id, personnelActionId: id,
                employeeId: action.employeeId, appUserId: actor.appUserId ?? undefined,
                detail: `Gagal membuat settlement ${action.type === "Termination" ? "PHK" : "Penggantian Hak"} untuk ${action.docNo} (best-effort — proses PA tetap berhasil): ${msg}`,
              },
            });
          } catch { /* never */ }
        }
      }

      // ===== 5-OFFBOARDING: proses offboarding OTOMATIS — best-effort, SETELAH =====
      // commit transaksi PA. PA Resignation/Termination/Retirement yang baru
      // diproses membuat proses offboarding (checklist clearance 9 tugas) bila
      // karyawan belum punya proses berjalan (Open). Kegagalan TIDAK memblokir
      // proses PA — dicatat ActivityLog + console.warn; HR bisa buat manual.
      let offboardingCreated = false;
      if (isTermination) {
        const exitDate = detail.lastDay ? new Date(String(detail.lastDay)) : effectiveDate;
        try {
          const existing = await db.offboarding.findFirst({
            where: { employeeId: action.employeeId, status: "Open" },
            select: { id: true },
          });
          if (!existing) {
            const ob = await createOffboardingWithTasks(db, {
              employeeId: action.employeeId,
              personnelActionId: id,
              lastDay: Number.isNaN(exitDate.getTime()) ? null : exitDate,
              reason: action.reason ?? null,
            });
            offboardingCreated = true;
            await db.activityLog.create({
              data: {
                appUserId: actor.appUserId, personnelActionId: id, employeeId: action.employeeId,
                action: "Created", entity: "Offboarding", entityId: ob.id,
                detail: `Proses offboarding otomatis dibuat dari ${action.docNo} (${paTypeLabel(action.type)}) oleh ${actorLabel} — ${DEFAULT_OFFBOARDING_TASKS.length} tugas clearance menunggu penyelesaian`,
              },
            });
          }
        } catch (oe) {
          const msg = oe instanceof Error ? oe.message : "unknown";
          console.warn(`[offboarding] gagal membuat proses offboarding otomatis untuk ${action.docNo}:`, msg);
          try {
            await db.activityLog.create({
              data: {
                appUserId: actor.appUserId, personnelActionId: id, employeeId: action.employeeId,
                action: "Error", entity: "Offboarding", entityId: id,
                detail: `Gagal membuat proses offboarding otomatis untuk ${action.docNo} (best-effort — proses PA tetap berhasil): ${msg}`,
              },
            });
          } catch { /* never */ }
        }
      }

      // ===== Notifikasi email — DIPROSES (perubahan diterapkan) ke karyawan =====
      void (async () => {
        try {
          const emp = action.employee;
          if (!emp.email) return;
          notifyEmailEvent(db, {
            event: "pa.processed",
            to: [{ email: emp.email, name: emp.fullName ?? undefined }],
            data: {
              nama: emp.fullName ?? "-", docNo: action.docNo, jenisAksi: paTypeLabel(action.type),
              tanggalEfektif: paDate(action.effectiveDate), alasan: action.reason ?? "-",
            },
          });
        } catch { /* never */ }
      })();
      return NextResponse.json({
        ok: true,
        status: "Processed",
        // 5-OFFBOARDING: flag proses offboarding otomatis (UI toast "otomatis dibuat")
        offboardingCreated,
        // T19: ringkasan final settlement (bila PA Termination) — breakdown + net
        ...(settlement
          ? {
              settlement: {
                gross: settlement.result.gross,
                deductions: settlement.result.deductions,
                tax: settlement.result.tax,
                net: settlement.result.net,
                masaKerja: settlement.result.masaKerja.label,
                upah: settlement.result.upah.total,
                rows: settlement.result.rows.map((r) => ({ code: r.code, label: r.label, kind: r.kind, amount: r.amount, note: r.note })),
                period: settlement.period,
                runNo: settlement.runNo,
                assignmentsCreated: settlement.assignmentsCreated,
                assignmentsUpdated: settlement.assignmentsUpdated,
              },
            }
          : {}),
      });
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
