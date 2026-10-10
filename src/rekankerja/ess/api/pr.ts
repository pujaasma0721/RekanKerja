// GET /api/rekankerja/ess/pr — PR saya (padanan oranHR MyPersonnelRequisition).
// POST — ajukan PR UNTUK DIRI SENDIRI (langsung submit ke jalur approval).
// PATCH — tarik PR sendiri (Draft|Submitted).
// Reuse pr-service (validasi identik jalur admin — kontrak T8-ESS-FRONTEND).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import {
  createPr, listPrs, cancelOwnPr, PR_DOC_TYPE, type PrInput,
} from "@/rekankerja/recruitment/services/pr-service";

// GET — riwayat PR saya + opsi dropdown form (SELECT sempit, tanpa PII luas).
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const [res, positions, jobs, orgUnits, offices] = await Promise.all([
      listPrs(db, { requestedById: employeeId, limit: 50, sortBy: "requestDate", sortDir: "desc", moneyVisible: false }),
      db.position.findMany({
        where: { active: true },
        select: { id: true, code: true, title: true, orgUnit: { select: { name: true } } },
        orderBy: [{ code: "asc" }],
      }),
      db.job.findMany({ where: { active: true }, select: { id: true, code: true, title: true }, orderBy: [{ code: "asc" }] }),
      db.orgUnit.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: [{ code: "asc" }] }),
      db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: [{ code: "asc" }] }),
    ]);

    return NextResponse.json({
      requests: res.rows.map((r) => ({
        id: r.id, prNo: r.prNo, requestDate: r.requestDate.slice(0, 10), status: r.status,
        positionTitle: r.positionTitle, requiredNo: r.requiredNo,
        employmentStatus: r.employmentStatus, reason: r.reason,
        earliestDate: r.earliestDate ? r.earliestDate.slice(0, 10) : null,
        latestDate: r.latestDate ? r.latestDate.slice(0, 10) : null,
        decisionNote: r.decisionNote,
        approval: r.approval && r.approval.status === "InProgress"
          ? { level: r.approval.currentLevel, total: r.approval.totalLevels, currentApproverName: r.approval.currentApprover }
          : null,
      })),
      options: {
        positions: positions.map((p) => ({ id: p.id, code: p.code, title: p.title, orgUnitName: p.orgUnit?.name ?? null })),
        jobs: jobs.map((j) => ({ id: j.id, code: j.code, title: j.title })),
        orgUnits: orgUnits.map((o) => ({ id: o.id, code: o.code, name: o.name })),
        offices: offices.map((o) => ({ id: o.id, code: o.code, name: o.name, city: o.city })),
      },
      stats: res.stats,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan PR untuk DIRI SENDIRI (langsung Submitted + chain).
// Body: { positionId, jobId?, orgUnitId?, companyOfficeId?, requiredNo,
//         employmentStatus?, preferredSource?, earliestDate?, latestDate?,
//         reason?, miscSpec?, additionalQualification? }
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const input: PrInput = {
      requestDate: new Date().toISOString().slice(0, 10),
      requestedById: employeeId, // ESS: selalu untuk diri sendiri
      positionId: b.positionId ? String(b.positionId) : null,
      jobId: b.jobId ? String(b.jobId) : null,
      orgUnitId: b.orgUnitId ? String(b.orgUnitId) : null,
      companyOfficeId: b.companyOfficeId ? String(b.companyOfficeId) : null,
      requiredNo: Number(b.requiredNo ?? 1),
      employmentStatus: String(b.employmentStatus ?? "Permanent"),
      preferredSource: b.preferredSource ? String(b.preferredSource) : null,
      earliestDate: b.earliestDate || null,
      latestDate: b.latestDate || null,
      recruitmentOfficerId: null,
      reason: b.reason ? String(b.reason) : null,
      miscSpec: b.miscSpec ? String(b.miscSpec) : null,
      additionalQualification: b.additionalQualification ? String(b.additionalQualification) : null,
      salaryBudget: null, // anggaran diisi HR lewat app admin (gating vault)
      autoPostOpening: false,
      slaTargetDays: null,
      replacedEmployeeId: null,
    };

    const res = await createPr(db, input, { submit: true, actorName: fullName });

    // notifikasi approver jenjang pertama — paritas jalur admin (pola ess/leave)
    void (async () => {
      try {
        const pos = await db.position.findUnique({ where: { id: input.positionId ?? "" }, select: { title: true } }).catch(() => null);
        notifyEmailEvent(db, {
          event: "recruitment.pr.submitted",
          to: await approverEmailsOf(db, employeeId),
          data: {
            nama: fullName, docNo: res.prNo, posisi: pos?.title ?? "-",
            jumlahOrang: String(input.requiredNo), statusKerja: input.employmentStatus,
            alasan: input.reason ?? "-",
          },
        });
        await notifyEvent(db, {
          to: "nextApprover", docType: PR_DOC_TYPE, docNo: res.prNo,
          title: `Permintaan karyawan ${res.prNo} menunggu persetujuan Anda`,
          body: `${fullName} — ${pos?.title ?? "-"} (${input.requiredNo} orang, ${input.employmentStatus})`,
          kind: "recruitment", link: "recruitment:pr-approval",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama ESS */ }
    })();

    return NextResponse.json({
      prNo: res.prNo, status: "Submitted",
      approvalLevels: res.approvalLevels, firstApprover: res.firstApprover,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — tarik PR SENDIRI (Draft|Submitted). Body: { id, note? }
export async function PATCH(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const res = await cancelOwnPr(db, {
      id: String(b.id), employeeId,
      note: b.note ? String(b.note) : undefined, actorName: fullName,
    });
    void notifyEvent(db, {
      to: "admins", docType: PR_DOC_TYPE, docNo: res.prNo,
      title: `Permintaan karyawan ${res.prNo} ditarik pemohon`,
      body: `${fullName} menarik PR-nya${b.note ? ` — catatan: ${String(b.note)}` : ""}`,
      kind: "recruitment", link: "recruitment:pr",
    }).catch(() => {});
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
