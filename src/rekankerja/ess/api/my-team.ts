// GET  /api/rekankerja/ess/my-team — workspace atasan "Tim Saya" (P3.3-BM / D-BM25).
// Agregat READ-ONLY tim langsung dalam SATU respons (UI sekali fetch):
//   headcount · members (kehadiran 7 hari, tenure, cuti, pending approval
//   per anggota) · pendingApprovals (pengajuan anggota tim yang menunggu
//   keputusan AKTOR sebagai approver jenjang berjalan) · upcoming
//   (anniversary & akhir kontrak ≤60 hari) · todayStats.
// Akses = atasan langsung: ada assignment AKTIF (validTo null) yang
// manajernya = aktor DAN bawahan Active — selain itu 403.
// POST — putuskan pengajuan (approve|reject) ME-REUSE service keputusan
// modul yang sama dengan jalur admin (decideRequest / decideWorkoff /
// decideOvertimeOrder / decideTravelRequest — single funnel, ActivityLog +
// otorisasi approver jenjang ditangani engine: DecisionForbiddenError 403).
import { NextResponse } from "next/server";
import { requireEss, fmtIsoDate, essCanAdmin } from "@/rekankerja/ess/api/ess-auth";
import { dayStart, addDays, decideWorkoff, decideOvertimeOrder } from "@/rekankerja/time-attendance/services/attendance-service";
import { decideRequest } from "@/rekankerja/leave/services/leave-service";
import { decideTravelRequest } from "@/rekankerja/travel/services/travel-service";
import { DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";

/** 403 bila bukan atasan langsung (tidak punya bawahan aktif). */
const MANAGER_ONLY_MSG = "Hanya untuk atasan langsung";

/** docType chain yang dicakup kotak approval Tim Saya (identifier — nilai
 * teknis domain, dirender via peta label bilingual di UI, bukan teks tampil). */
const DT_LEAVE = "Leave";
const DT_WORKOFF = "WorkOff";
const DT_OVERTIME = "Overtime";
const DT_TRAVEL = "Travel";
const TEAM_DOC_TYPES = [DT_LEAVE, DT_WORKOFF, DT_OVERTIME, DT_TRAVEL] as const;

/** kind pengajuan yang bisa diputuskan dari workspace (identik docType,
 * huruf kecil — kontrak POST). */
const KIND_LEAVE = "leave";
const KIND_WORKOFF = "workoff";
const KIND_OVERTIME = "overtime";
const KIND_TRAVEL = "travel";
const TEAM_KIND_SET: ReadonlySet<string> = new Set([KIND_LEAVE, KIND_WORKOFF, KIND_OVERTIME, KIND_TRAVEL]);

/** Ambil id bawahan langsung aktif (assignment aktif + karyawan Active). */
async function directReportIds(db: import("@/rekankerja/shared/lib/tenant-db").TenantDb, managerId: string): Promise<string[]> {
  const rows = await db.employeeAssignment.findMany({
    where: { managerId, validTo: null, employee: { status: "Active" } },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}

/** Tanggal anniversary (bulan/tanggal joinDate) berikutnya dalam ≤60 hari —
 * null bila di luar jendela. years = tahun penuh yang genap saat tanggal itu. */
function nextAnniversary(joinDate: Date, today: Date, horizon: Date): { date: Date; years: number } | null {
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const cand = new Date(year, joinDate.getMonth(), joinDate.getDate());
    if (cand.getTime() < today.getTime() || cand.getTime() > horizon.getTime()) continue;
    return { date: cand, years: year - joinDate.getFullYear() };
  }
  return null;
}

// GET — agregat Tim Saya (satu respons untuk seluruh halaman).
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const reportIds = await directReportIds(db, employeeId);
    if (reportIds.length === 0) {
      return NextResponse.json({ error: MANAGER_ONLY_MSG }, { status: 403 });
    }

    const today = dayStart(new Date());
    const weekStart = addDays(today, -6);
    const horizon = addDays(today, 60);

    // ===== (1) profil anggota tim (assignment aktif + snapshot Employee) =====
    const assignments = await db.employeeAssignment.findMany({
      where: { managerId: employeeId, validTo: null, employeeId: { in: reportIds } },
      orderBy: { validFrom: "desc" },
      select: {
        employeeId: true,
        employmentStatus: true,
        position: { select: { title: true } },
        orgUnit: { select: { name: true } },
        employee: {
          select: {
            id: true, employeeNo: true, fullName: true, photoUrl: true,
            joinDate: true, contractEnd: true, endDate: true,
            position: { select: { title: true } },
          },
        },
      },
    });
    // assignment aktif terbaru per bawahan (defensif — normalnya tepat 1 baris)
    const latestByEmp = new Map<string, (typeof assignments)[number]>();
    for (const a of assignments) if (!latestByEmp.has(a.employeeId)) latestByEmp.set(a.employeeId, a);

    // ===== (2) kehadiran 7 hari terakhir seluruh tim (1 kueri) =====
    const dailyRows = await db.attendanceDaily.findMany({
      where: { employeeId: { in: reportIds }, workDate: { gte: weekStart, lte: today } },
      select: { employeeId: true, workDate: true, status: true },
    });
    const dailyByEmp = new Map<string, Map<string, string>>();
    for (const r of dailyRows) {
      const per = dailyByEmp.get(r.employeeId) ?? new Map<string, string>();
      per.set(fmtIsoDate(r.workDate), r.status);
      dailyByEmp.set(r.employeeId, per);
    }
    const weekDates: string[] = [];
    for (let i = 6; i >= 0; i--) weekDates.push(fmtIsoDate(addDays(today, -i)));

    // ===== (3) cuti disetujui: hari ini + mendatang (1 kueri) =====
    const activeLeaves = await db.leaveRequest.findMany({
      where: {
        employeeId: { in: reportIds },
        status: { in: ["Approved", "MassLeave"] },
        dateTo: { gte: today },
      },
      orderBy: { dateFrom: "asc" },
      select: { employeeId: true, dateFrom: true, dateTo: true, leaveType: { select: { name: true } } },
    });
    const leaveTodayByEmp = new Map<string, string>();
    const leaveUpcomingByEmp = new Map<string, { type: string; from: string }>();
    for (const lv of activeLeaves) {
      const from = dayStart(lv.dateFrom);
      if (from.getTime() <= today.getTime()) {
        leaveTodayByEmp.set(lv.employeeId, lv.leaveType.name);
      } else if (!leaveUpcomingByEmp.has(lv.employeeId)) {
        leaveUpcomingByEmp.set(lv.employeeId, { type: lv.leaveType.name, from: fmtIsoDate(from) });
      }
    }

    // ===== (4) chain InProgress yang approver jenjang BERJALAN = aktor =====
    // (pola kotak approval dashboard ESS — approverEmployeeId langsung;
    // HR_ADMIN tidak cocok: ESS tidak mewakili jenjang admin).
    const myChains = await db.approvalChain.findMany({
      where: {
        status: "InProgress",
        docType: { in: [...TEAM_DOC_TYPES] },
        steps: { some: { status: "Current", approverEmployeeId: employeeId } },
      },
      select: {
        docType: true, docId: true, employeeId: true, amount: true,
        currentLevel: true, totalLevels: true,
      },
    });
    const chainByType = new Map<string, { docId: string; employeeId: string; amount: number | null; level: number; total: number }[]>();
    for (const c of myChains) {
      const list = chainByType.get(c.docType) ?? [];
      list.push({ docId: c.docId, employeeId: c.employeeId, amount: c.amount, level: c.currentLevel, total: c.totalLevels });
      chainByType.set(c.docType, list);
    }
    const idsOf = (dt: string) => (chainByType.get(dt) ?? []).map((x) => x.docId); // dt = DT_* konstanta

    // gerbang vault uang — amount (uang muka travel) hanya bila aktor boleh lihat.
    const mv = await getMoneyView(db, { userId: m.actor.platformUserId, membershipRole: m.actor.platformRole });

    // ===== (5) dokumen pengajuan per jenis (hanya milik anggota tim) =====
    const [leaves, workoffs, overtimes, travels] = await Promise.all([
      db.leaveRequest.findMany({
        where: { id: { in: idsOf(DT_LEAVE) }, employeeId: { in: reportIds }, status: "Submitted" },
        select: {
          id: true, docNo: true, employeeId: true, requestDate: true, dateFrom: true, dateTo: true,
          workingDays: true, leaveType: { select: { name: true } },
          employee: { select: { fullName: true, employeeNo: true } },
        },
      }),
      db.workOffPermission.findMany({
        where: { id: { in: idsOf(DT_WORKOFF) }, employeeId: { in: reportIds }, status: "Pending" },
        select: {
          id: true, docNo: true, employeeId: true, createdAt: true, dateFrom: true, dateTo: true,
          paid: true, reason: true,
          employee: { select: { fullName: true, employeeNo: true } },
        },
      }),
      db.overtimeOrder.findMany({
        where: { id: { in: idsOf(DT_OVERTIME) }, employeeId: { in: reportIds }, status: "Pending" },
        select: {
          id: true, orderNo: true, employeeId: true, createdAt: true, overtimeDate: true,
          timeFrom: true, timeTo: true, planMinutes: true, dayCategory: true,
          employee: { select: { fullName: true, employeeNo: true } },
        },
      }),
      db.travelRequest.findMany({
        where: { id: { in: idsOf(DT_TRAVEL) }, employeeId: { in: reportIds }, status: "Submitted" },
        select: {
          id: true, docNo: true, employeeId: true, requestDate: true, dateFrom: true, dateTo: true,
          purpose: true,
          employee: { select: { fullName: true, employeeNo: true } },
        },
      }),
    ]);

    type PendingRow = {
      kind: "leave" | "workoff" | "overtime" | "travel"; id: string; refNo: string;
      dateFrom: string; dateTo: string | null; requesterName: string; requesterNo: string;
      summary: string; amount: number | null;
      approval: { level: number; total: number } | null;
      detail: Record<string, unknown>;
      sortKey: number;
    };
    const pendingApprovals: PendingRow[] = [];
    const pendingCountByEmp = new Map<string, number>();
    const bumpPending = (empId: string) => pendingCountByEmp.set(empId, (pendingCountByEmp.get(empId) ?? 0) + 1);

    for (const r of leaves) {
      bumpPending(r.employeeId);
      pendingApprovals.push({
        kind: "leave", id: r.id, refNo: r.docNo,
        dateFrom: fmtIsoDate(r.dateFrom), dateTo: fmtIsoDate(r.dateTo),
        requesterName: r.employee.fullName, requesterNo: r.employee.employeeNo,
        summary: `${r.leaveType.name} — ${r.workingDays} hari kerja`,
        amount: null,
        approval: (() => { const c = chainByType.get(DT_LEAVE)?.find((x) => x.docId === r.id); return c ? { level: c.level, total: c.total } : null; })(),
        detail: { typeName: r.leaveType.name, days: r.workingDays },
        sortKey: new Date(r.requestDate).getTime(),
      });
    }
    for (const r of workoffs) {
      bumpPending(r.employeeId);
      pendingApprovals.push({
        kind: "workoff", id: r.id, refNo: r.docNo,
        dateFrom: fmtIsoDate(r.dateFrom), dateTo: fmtIsoDate(r.dateTo),
        requesterName: r.employee.fullName, requesterNo: r.employee.employeeNo,
        summary: `Izin tidak masuk (${r.paid ? "dibayar" : "tidak dibayar"})${r.reason ? ` — ${r.reason}` : ""}`,
        amount: null,
        approval: (() => { const c = chainByType.get(DT_WORKOFF)?.find((x) => x.docId === r.id); return c ? { level: c.level, total: c.total } : null; })(),
        detail: { paid: r.paid, reason: r.reason },
        sortKey: new Date(r.createdAt).getTime(),
      });
    }
    for (const r of overtimes) {
      bumpPending(r.employeeId);
      pendingApprovals.push({
        kind: "overtime", id: r.id, refNo: r.orderNo,
        dateFrom: fmtIsoDate(r.overtimeDate), dateTo: null,
        requesterName: r.employee.fullName, requesterNo: r.employee.employeeNo,
        summary: `Lembur ${fmtIsoDate(r.overtimeDate)} — rencana ${r.planMinutes} menit`,
        amount: null,
        approval: (() => { const c = chainByType.get(DT_OVERTIME)?.find((x) => x.docId === r.id); return c ? { level: c.level, total: c.total } : null; })(),
        detail: { planMinutes: r.planMinutes, dayCategory: r.dayCategory },
        sortKey: new Date(r.createdAt).getTime(),
      });
    }
    for (const r of travels) {
      bumpPending(r.employeeId);
      const chain = chainByType.get(DT_TRAVEL)?.find((x) => x.docId === r.id);
      pendingApprovals.push({
        kind: "travel", id: r.id, refNo: r.docNo,
        dateFrom: fmtIsoDate(r.dateFrom), dateTo: fmtIsoDate(r.dateTo),
        requesterName: r.employee.fullName, requesterNo: r.employee.employeeNo,
        summary: `Perjalanan dinas — ${r.purpose || "-"}`,
        amount: chain?.amount != null && mv.canSee ? chain.amount : null,
        approval: chain ? { level: chain.level, total: chain.total } : null,
        detail: { purpose: r.purpose },
        sortKey: new Date(r.requestDate).getTime(),
      });
    }
    pendingApprovals.sort((a, b) => a.sortKey - b.sortKey);

    // ===== (6) statistik hari ini (AttendanceDaily + cuti disetujui) =====
    const todayRows = dailyRows.filter((r) => r.workDate.getTime() === today.getTime());
    const present = todayRows.filter((r) => r.status === "Present").length;
    const late = todayRows.filter((r) => r.status === "Late").length;
    const absent = todayRows.filter((r) => r.status === "Absent").length;
    const dailyOnLeave = todayRows.filter((r) => r.status === "OnLeave").length;
    const onLeave = dailyOnLeave + [...leaveTodayByEmp.keys()].filter((id) => {
      const s = dailyByEmp.get(id)?.get(fmtIsoDate(today));
      return s !== "OnLeave"; // belum ter-regen → tetap dihitung dari cuti disetujui
    }).length;

    // ===== (7) members (urut nama) =====
    const members = reportIds
      .map((id) => {
        const a = latestByEmp.get(id);
        const emp = a?.employee;
        const join = emp?.joinDate ? new Date(emp.joinDate) : null;
        const tenureYears = join
          ? Math.round(((today.getTime() - join.getTime()) / (365.25 * 86_400_000)) * 10) / 10
          : 0;
        return {
          employeeId: id,
          fullName: emp?.fullName ?? "-",
          employeeNo: emp?.employeeNo ?? "-",
          positionTitle: a?.position?.title ?? emp?.position?.title ?? null,
          orgUnitName: a?.orgUnit?.name ?? null,
          photoUrl: emp?.photoUrl ?? null,
          joinDate: join ? fmtIsoDate(join) : null,
          tenureYears,
          contractEndDate: emp?.contractEnd ? fmtIsoDate(new Date(emp.contractEnd)) : null,
          employmentStatus: a?.employmentStatus ?? "Permanent",
          present7d: weekDates.map((d) => ({ date: d, status: dailyByEmp.get(id)?.get(d) ?? null })),
          onLeaveToday: leaveTodayByEmp.has(id),
          onLeaveTodayType: leaveTodayByEmp.get(id) ?? null,
          onLeaveUpcoming: leaveUpcomingByEmp.has(id),
          onLeaveUpcomingType: leaveUpcomingByEmp.get(id)?.type ?? null,
          onLeaveUpcomingFrom: leaveUpcomingByEmp.get(id)?.from ?? null,
          pendingMyApprovalCount: pendingCountByEmp.get(id) ?? 0,
        };
      })
      .sort((x, y) => x.fullName.localeCompare(y.fullName, "id"));

    // ===== (8) tanggal penting ≤60 hari (anniversary + akhir kontrak) =====
    type UpcomingRow = { employeeId: string; type: "anniversary" | "end"; date: string; years: number | null };
    const upcoming: UpcomingRow[] = [];
    for (const mem of members) {
      const emp = latestByEmp.get(mem.employeeId)?.employee;
      if (emp?.joinDate) {
        const ann = nextAnniversary(new Date(emp.joinDate), today, horizon);
        if (ann && ann.years > 0) {
          upcoming.push({ employeeId: mem.employeeId, type: "anniversary", date: fmtIsoDate(ann.date), years: ann.years });
        }
      }
      // akhir PKWT / endDate terdekat yang masih di masa depan ≤60 hari
      const ends = [emp?.contractEnd ? new Date(emp.contractEnd) : null, emp?.endDate ? new Date(emp.endDate) : null]
        .filter((d): d is Date => d != null && d.getTime() >= today.getTime() && d.getTime() <= horizon.getTime())
        .sort((x, y) => x.getTime() - y.getTime());
      if (ends.length > 0) {
        upcoming.push({ employeeId: mem.employeeId, type: "end", date: fmtIsoDate(ends[0]!), years: null });
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      headcount: reportIds.length,
      members,
      pendingApprovals: pendingApprovals.map(({ sortKey: _sortKey, ...rest }) => rest),
      upcoming,
      todayStats: { present, late, absent, onLeave },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — putuskan pengajuan anggota tim dari workspace Tim Saya.
// Body: { kind: leave|workoff|overtime|travel, id, action: approve|reject, note? }
// Delegasi KE SERVICE MODUL YANG SAMA dengan jalur admin (bukan re-implement):
// validasi saldo/chain/regen/ActivityLog tinggal di service; otorisasi
// approver jenjang berjalan (atau delegasi aktif) ditangani engine.
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName, appUserId, platformUserId, platformRole } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const kind = String(b.kind ?? "");
    const id = String(b.id ?? "");
    const action = b.action === "reject" ? "reject" : "approve";
    const note = b.note ? String(b.note) : undefined;
    if (!id || !TEAM_KIND_SET.has(kind)) {
      return NextResponse.json({ error: "kind & id wajib (leave|workoff|overtime|travel)" }, { status: 400 });
    }
    // guard workspace: hanya atasan langsung (guard sesungguhnya tetap di engine).
    const reportIds = await directReportIds(db, employeeId);
    if (reportIds.length === 0) {
      return NextResponse.json({ error: MANAGER_ONLY_MSG }, { status: 403 });
    }

    // role ESS diteruskan apa adanya — pola pr-to-approve (bukan OWNER/ADMIN/HR
    // → engine menuntut approver jenjang berjalan / delegasi aktif).
    const actor = {
      role: essCanAdmin(m.actor) ? platformRole : "ESS",
      employeeId,
      name: fullName,
    };

    let result: { status: string; approval?: { currentLevel: number; totalLevels: number } | null } | null = null;
    if (kind === KIND_LEAVE) {
      const res = await decideRequest(db, { id, action, note, actorId: appUserId ?? platformUserId, actor });
      result = {
        status: res.status,
        approval: res.approval ? { currentLevel: res.approval.currentLevel, totalLevels: res.approval.totalLevels } : null,
      };
    } else if (kind === KIND_WORKOFF) {
      const res = await decideWorkoff(db, id, action, { note, actor });
      result = {
        status: (res.permit as { status?: string } | null)?.status ?? (action === "approve" ? "Approved" : "Rejected"),
        approval: res.approval ? { currentLevel: res.approval.currentLevel, totalLevels: res.approval.totalLevels } : null,
      };
    } else if (kind === KIND_OVERTIME) {
      const res = await decideOvertimeOrder(db, id, action, { note, actor });
      result = {
        status: (res.order as { status?: string } | null)?.status ?? (action === "approve" ? "Approved" : "Rejected"),
        approval: res.approval ? { currentLevel: res.approval.currentLevel, totalLevels: res.approval.totalLevels } : null,
      };
    } else {
      const res = await decideTravelRequest(db, { id, action, note, actorId: appUserId ?? platformUserId, actor });
      result = {
        status: res.status,
        approval: res.approval ? { currentLevel: res.approval.currentLevel, totalLevels: res.approval.totalLevels } : null,
      };
    }

    // notifikasi in-app fire-and-forget ke pemohon saat keputusan FINAL
    // (paritas jalur admin leave/api/requests.ts PATCH — keputusan jenjang
    // menengah tetap menunggu, tidak mengganggu pemohon).
    if (result && !result.approval) {
      void (async () => {
        try {
          const docMap: Record<string, { docType: string; emp: { employeeId: string; docNo: string } | null }> = {
            leave: { docType: "Leave", emp: await (async () => { const r = await db.leaveRequest.findUnique({ where: { id }, select: { employeeId: true, docNo: true } }); return r ? { employeeId: r.employeeId, docNo: r.docNo } : null; })() },
            workoff: { docType: "WorkOff", emp: await (async () => { const r = await db.workOffPermission.findUnique({ where: { id }, select: { employeeId: true, docNo: true } }); return r ? { employeeId: r.employeeId, docNo: r.docNo } : null; })() },
            overtime: { docType: "Overtime", emp: await (async () => { const r = await db.overtimeOrder.findUnique({ where: { id }, select: { employeeId: true, orderNo: true } }); return r ? { employeeId: r.employeeId, docNo: r.orderNo } : null; })() },
            travel: { docType: "Travel", emp: await (async () => { const r = await db.travelRequest.findUnique({ where: { id }, select: { employeeId: true, docNo: true } }); return r ? { employeeId: r.employeeId, docNo: r.docNo } : null; })() },
          };
          const d = docMap[kind];
          if (d?.emp) {
            await notifyEvent(db, {
              to: "employee", docType: d.docType, docNo: d.emp.docNo, docId: id, employeeId: d.emp.employeeId,
              title: `Pengajuan ${d.emp.docNo} ${action === "approve" ? "disetujui" : "ditolak"} oleh ${fullName}`,
              body: action === "approve"
                ? `Pengajuan Anda telah disetujui atasan${note ? ` — catatan: ${note}` : ""}`
                : `Pengajuan Anda ditolak${note ? ` — catatan: ${note}` : ""}`,
              kind: kind === "leave" ? "leave" : kind === "travel" ? "travel" : "attendance",
            });
          }
        } catch { /* notifikasi tidak boleh mengganggu proses utama */ }
      })();
    }

    return NextResponse.json({ ok: true, kind, id, action, status: result?.status ?? null, approval: result?.approval ?? null });
  } catch (e) {
    if (e instanceof DecisionConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({
        error: "Anda bukan approver jenjang berjalan untuk pengajuan ini (atau keputusan sudah diproses) — muat ulang daftar.",
      }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
