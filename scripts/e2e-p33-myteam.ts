// P3.3-BM (D-BM25) — E2E TIM SAYA / workspace atasan (local dev :3000):
//   (0) SETUP (prisma langsung): pastikan akun ESS non-manajer (yusuf — pola
//       seed-ess-demo-user) + akun ESS manajer; pilih pasangan (manajer,
//       bawahan) — prioritas yang rantai approval Leave-nya SATU jenjang &
//       approver = manajer itu sendiri (buildApprovalChain);
//   (1) login manajer → GET /ess/me → isManager true;
//   (2) GET /ess/my-team → headcount == prisma; members + todayStats +
//       pendingApprovals + upcoming terbentuk (field kunci hadir, present7d=7);
//   (3) non-manajer → /ess/me isManager false → GET my-team 403;
//   (4) fixture cuti dari bawahan (service submitRequest — jalur yang sama
//       dgn ESS): muncul di pendingApprovals + pendingMyApprovalCount naik →
//       manajer approve via POST my-team → status Approved (rantai 1 jenjang;
//       fallback: jenjang sisa diselesaikan via service dgn aktor admin) +
//       ActivityLog approve tercatat;
//   (5) guard: putus ulang dokumen sudah Approved → 400; id tidak dikenal → 400;
//   (6) setelah approve: pendingApprovals tidak memuat dokumen; hitungan
//       pendingMyApprovalCount bawahan kembali ke baseline;
//   (7) CLEANUP: hapus cuti uji + chain + notifikasi (ActivityLog
//       DIPERTAHANKAN — audit trail, pola P1.x); restore AttendanceDaily.
// Jalankan: bun scripts/e2e-p33-myteam.ts  (server dev di :3000)
import "./lib/env";
import { db as platform } from "@/lib/db";
import { hashPassword } from "@/rekankerja/shared/lib/auth";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { buildApprovalChain } from "@/rekankerja/shared/services/approval-engine";
import { submitRequest, decideRequest } from "@/rekankerja/leave/services/leave-service";

const BASE = "http://localhost:3000";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const TENANT_SLUG = "pt-mitra-industri-internasional";
const ME_API = "/api/rekankerja/ess/me";
const TEAM_API = "/api/rekankerja/ess/my-team";
// akun demo ESS non-manajer (persis seed-ess-demo-user — idempoten)
const NON_MGR = { email: "yusuf@mii.co.id", password: "EssDemo123!", employeeNo: "MII00010" };
// akun ESS manajer uji (dibuat bila belum ada — pola seed; dipertahankan utk
// verifikasi browser manual; idempoten utk re-run)
const MGR = { email: "myteam.p33@mii.co.id", password: "P33MyTeam123!" };
const NONCE = `e2e-p33-${Date.now().toString().slice(-6)}`;

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie) — pola e2e-p1. Retry ringan utk
 *  gangguan socket transient dev-server (TIDAK me-retry status HTTP). */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); }
    }
    throw lastErr;
  }
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Pastikan akun ESS ada (AppUser tenant + platform user + membership MII) —
 *  pola scripts/seed-ess-demo-user.ts, idempoten. */
async function ensureEssAccount(email: string, password: string, employeeId: string, appRole: "ESS" | "Approver", platformRole: string) {
  const db = getTenantClient(SCHEMA);
  let appUser = await db.appUser.findFirst({ where: { email } });
  if (!appUser) {
    appUser = await db.appUser.create({
      data: {
        username: email.split("@")[0]!,
        fullName: email.split("@")[0]!,
        email,
        role: appRole,
        employeeId,
        passwordChangedAt: new Date(),
      },
    });
  } else {
    appUser = await db.appUser.update({ where: { id: appUser.id }, data: { employeeId, email, role: appRole } });
  }
  const existingAccess = await db.userMenuAccess.findUnique({ where: { appUserId: appUser.id } });
  if (!existingAccess) {
    await db.userMenuAccess.create({ data: { appUserId: appUser.id, mode: "CUSTOM", menusJson: "{}" } });
  } else if (existingAccess.mode !== "CUSTOM") {
    await db.userMenuAccess.update({ where: { appUserId: appUser.id }, data: { mode: "CUSTOM", menusJson: "{}" } });
  }
  let user = await platform.user.findUnique({ where: { email } });
  if (!user) {
    user = await platform.user.create({ data: { email, name: email, passwordHash: hashPassword(password) } });
  }
  const tenant = await platform.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error("tenant MII tidak ditemukan");
  const m = await platform.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } });
  if (!m) {
    await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: platformRole } });
  }
  const hist = await db.passwordHistory.findFirst({ where: { appUserId: appUser.id } });
  if (!hist) {
    await db.passwordHistory.create({ data: { appUserId: appUser.id, hash: hashPassword(password) } });
  }
  return appUser;
}

async function main() {
  const startedAt = new Date();
  console.log(`E2E P3.3 Tim Saya — ${startedAt.toISOString()} (nonce ${NONCE})`);
  const db = getTenantClient(SCHEMA);

  // ================= (0) SETUP =================
  const nonMgrEmp = await db.employee.findFirst({ where: { employeeNo: NON_MGR.employeeNo } });
  if (!nonMgrEmp) { console.error(`karyawan ${NON_MGR.employeeNo} tidak ditemukan`); process.exit(1); }
  await ensureEssAccount(NON_MGR.email, NON_MGR.password, nonMgrEmp.id, "Approver", "HR");
  const nonMgrReports = await db.employeeAssignment.count({
    where: { managerId: nonMgrEmp.id, validTo: null, employee: { status: "Active" } },
  });
  ok(nonMgrReports === 0, `non-manajer (${NON_MGR.employeeNo}) tanpa bawahan aktif`, `${nonMgrReports} bawahan`);

  // pasangan (manajer, bawahan): prioritas rantai Leave 1-jenjang & approver =
  // manajer sendiri; fallback pasangan pertama (rantai diselesaikan via service).
  const rows = await db.employeeAssignment.findMany({
    where: { validTo: null, managerId: { not: null }, employee: { status: "Active" } },
    select: { managerId: true, employeeId: true },
  });
  const byMgr = new Map<string, string[]>();
  for (const r of rows) byMgr.set(r.managerId!, [...(byMgr.get(r.managerId!) ?? []), r.employeeId]);
  let pair: { managerId: string; reportId: string; singleLevel: boolean } | null = null;
  let fallbackPair: { managerId: string; reportId: string; singleLevel: boolean } | null = null;
  const mgrIds = [...byMgr.keys()];
  const mgrInfos = await db.employee.findMany({
    where: { id: { in: mgrIds }, status: "Active" },
    select: { id: true, employeeNo: true, fullName: true },
  });
  // tim terkecil dulu (assert headcount ringan), lalu uji rantai Leave-nya
  for (const mi of [...mgrInfos].sort((a, b) => (byMgr.get(a.id)?.length ?? 0) - (byMgr.get(b.id)?.length ?? 0))) {
    for (const rep of byMgr.get(mi.id) ?? []) {
      if (!fallbackPair) fallbackPair = { managerId: mi.id, reportId: rep, singleLevel: false };
      const ch = await buildApprovalChain(db, rep, "Leave");
      if (ch.steps.length > 0 && ch.steps.every((s) => s.approverEmployeeId === mi.id)) {
        pair = { managerId: mi.id, reportId: rep, singleLevel: true };
        break;
      }
    }
    if (pair) break;
  }
  pair = pair ?? fallbackPair;
  if (!pair) { console.error("tidak ada pasangan manajer-bawahan aktif di MII"); process.exit(1); }
  const mgrInfo = mgrInfos.find((m) => m.id === pair!.managerId)!;
  const expectedHeadcount = new Set((byMgr.get(pair.managerId) ?? [])).size;
  const reportInfo = await db.employee.findUnique({
    where: { id: pair.reportId },
    select: { employeeNo: true, fullName: true, gender: true },
  });
  ok(!!reportInfo, "bawahan uji ditemukan", `${reportInfo?.employeeNo} ${reportInfo?.fullName}`);
  console.log(`  manajer: ${mgrInfo.employeeNo} ${mgrInfo.fullName} (${expectedHeadcount} bawahan) · bawahan: ${reportInfo?.employeeNo} (rantai 1-jenjang: ${pair.singleLevel})`);

  await ensureEssAccount(MGR.email, MGR.password, pair.managerId, "ESS", "VIEWER");
  const leaveCountBefore = await db.leaveRequest.count();
  const chainCountBefore = await db.approvalChain.count({ where: { docType: "Leave" } });

  const mgr = new Sesi();
  const nonMgr = new Sesi();
  const mgrLogin = await mgr.api("POST", "/api/auth/login", { email: MGR.email, password: MGR.password });
  const nonMgrLogin = await nonMgr.api("POST", "/api/auth/login", { email: NON_MGR.email, password: NON_MGR.password });
  ok(mgrLogin.status === 200, "login ESS manajer", MGR.email);
  ok(nonMgrLogin.status === 200, "login ESS non-manajer", NON_MGR.email);
  if (mgrLogin.status !== 200 || nonMgrLogin.status !== 200) process.exit(1);

  // ================= (1) /ess/me isManager =================
  console.log("\n[(1)] /ess/me — flag isManager");
  const meMgr = await mgr.api("GET", ME_API);
  ok(meMgr.status === 200 && meMgr.json?.employee?.id === pair.managerId, "GET me manajer 200 + profil benar");
  ok(meMgr.json?.isManager === true, "isManager TRUE utk manajer", `json.isManager=${JSON.stringify(meMgr.json?.isManager)}`);

  // ================= (2) GET my-team — agregat =================
  console.log("\n[(2)] GET my-team — headcount + field agregat");
  const team = await mgr.api("GET", TEAM_API);
  ok(team.status === 200, "GET my-team (manajer) → 200", `status=${team.status}`);
  ok(team.json?.headcount === expectedHeadcount, "headcount == jumlah bawahan aktif (prisma)",
    `api=${team.json?.headcount} vs prisma=${expectedHeadcount}`);
  const members: any[] = team.json?.members ?? [];
  ok(Array.isArray(members) && members.length === expectedHeadcount, "members[] length == headcount");
  const me3 = members.find((x) => x.employeeId === pair.reportId);
  ok(!!me3, "bawahan uji ada di members[]");
  ok(me3 && [me3.fullName, me3.employeeNo, me3.positionTitle, me3.orgUnitName, me3.photoUrl, me3.joinDate, me3.contractEndDate, me3.employmentStatus].every((v) => v !== undefined),
    "field profil anggota hadir (fullName/employeeNo/positionTitle/orgUnitName/photoUrl/joinDate/contractEndDate/employmentStatus)");
  ok(typeof me3?.tenureYears === "number", "tenureYears angka", `${me3?.tenureYears}`);
  ok(Array.isArray(me3?.present7d) && me3.present7d.length === 7 && me3.present7d.every((d: any) => typeof d.date === "string" && (d.status === null || typeof d.status === "string")),
    "present7d = 7 entri {date,status|null}");
  ok([me3?.onLeaveToday, me3?.onLeaveUpcoming].every((v) => typeof v === "boolean"), "flag onLeaveToday/onLeaveUpcoming boolean");
  ok(typeof me3?.pendingMyApprovalCount === "number", "pendingMyApprovalCount angka");
  const ts = team.json?.todayStats ?? {};
  ok(["present", "late", "absent", "onLeave"].every((k) => typeof ts[k] === "number"), "todayStats keys hadir (present/late/absent/onLeave)", JSON.stringify(ts));
  ok(Array.isArray(team.json?.pendingApprovals) && Array.isArray(team.json?.upcoming), "pendingApprovals[] + upcoming[] array");
  const baselinePending: number = me3?.pendingMyApprovalCount ?? 0;

  // ================= (3) non-manajer → 403 =================
  console.log("\n[(3)] guard non-manajer");
  const meNon = await nonMgr.api("GET", ME_API);
  ok(meNon.status === 200 && meNon.json?.isManager === false, "isManager FALSE utk non-manajer", `json.isManager=${JSON.stringify(meNon.json?.isManager)}`);
  const denied = await nonMgr.api("GET", TEAM_API);
  ok(denied.status === 403, "GET my-team non-manajer → 403", `status=${denied.status}`);
  ok(/Hanya untuk atasan langsung/.test(denied.json?.error ?? ""), "pesan 403 bilingual sumber (ID)", denied.json?.error ?? "-");
  const deniedPost = await nonMgr.api("POST", TEAM_API, { kind: "leave", id: "x", action: "approve" });
  ok(deniedPost.status === 403, "POST my-team non-manajer → 403", `status=${deniedPost.status}`);

  // ================= (4) fixture cuti + approve dari workspace =================
  console.log("\n[(4)] fixture cuti bawahan → approve dari Tim Saya");
  const ctThn = await db.leaveType.findFirst({ where: { code: "CT-THN", active: true } });
  ok(!!ctThn, "jenis cuti CT-THN aktif (allowAdvance)", ctThn?.name ?? "-");
  if (!ctThn) process.exit(1);

  // tanggal bebas bentrok & notice: coba 8/15/22/29 hari ke depan.
  let submit: Awaited<ReturnType<typeof submitRequest>> | null = null;
  let leaveDate = "";
  for (const offset of [8, 15, 22, 29]) {
    const d = dayStart(new Date(Date.now() + offset * 86_400_000));
    const iso = isoLocal(d);
    const overlap = await db.leaveRequest.findFirst({
      where: {
        employeeId: pair.reportId,
        status: { in: ["Approved", "MassLeave", "Submitted"] },
        dateFrom: { lte: d }, dateTo: { gte: d },
      },
    });
    if (overlap) continue;
    try {
      submit = await submitRequest(db, {
        employeeId: pair.reportId,
        leaveTypeId: ctThn.id,
        dateFrom: iso, sessionFrom: "AM",
        dateTo: iso, sessionTo: "PM",
        reason: `${NONCE} uji workspace tim saya`,
        source: "ESS", actorName: "E2E P3.3",
      });
      leaveDate = iso;
      break;
    } catch { /* notice/blackout → coba offset berikutnya */ }
  }
  ok(!!submit, "submitRequest cuti 1 hari (service jalur ESS)", submit ? `${submit.docNo} @ ${leaveDate}` : "gagal semua kandidat tanggal");
  if (!submit) process.exit(1);
  const leaveId: string = (submit as any).id ?? (await db.leaveRequest.findUnique({ where: { docNo: submit.docNo } }))!.id;
  ok(!!leaveId, "id permintaan cuti terresolusi", leaveId.slice(-8));

  const chain = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: "Leave", docId: leaveId } },
    include: { steps: { orderBy: { levelNo: "asc" } } },
  });
  ok(!!chain && chain.status === "InProgress", "chain Leave InProgress dibuat");
  ok(chain?.steps.some((s) => s.status === "Current" && s.approverEmployeeId === pair.managerId),
    "jenjang berjalan = manajer (atasan langsung)",
    chain?.steps.find((s) => s.status === "Current")?.approverLabel ?? "-");

  const team2 = await mgr.api("GET", TEAM_API);
  const pend2: any[] = team2.json?.pendingApprovals ?? [];
  const row2 = pend2.find((p) => p.refNo === submit!.docNo);
  ok(team2.status === 200 && !!row2, "permintaan muncul di pendingApprovals (manajer)", row2 ? `${row2.kind} · ${row2.requesterName}` : "-");
  ok(row2?.kind === "leave" && !!row2?.dateFrom && !!row2?.requesterNo, "field pendingApprovals hadir (kind/dateFrom/requesterNo)");
  const meAfter = (team2.json?.members ?? []).find((x: any) => x.employeeId === pair.reportId);
  ok((meAfter?.pendingMyApprovalCount ?? -1) === baselinePending + 1,
    "pendingMyApprovalCount bawahan naik +1", `${baselinePending} → ${meAfter?.pendingMyApprovalCount}`);

  // pra-keadaan AttendanceDaily rentang cuti (utk restore cleanup)
  const priorDailies = await db.attendanceDaily.findMany({
    where: { employeeId: pair.reportId, workDate: { gte: new Date(`${leaveDate}T00:00:00`), lte: new Date(`${leaveDate}T00:00:00`) } },
  });

  const approve = await mgr.api("POST", TEAM_API, { kind: "leave", id: leaveId, action: "approve" });
  ok(approve.status === 200, "POST my-team approve → 200", `status=${approve.status} body=${JSON.stringify(approve.json)}`);
  if (pair.singleLevel) {
    ok(approve.json?.status === "Approved", "keputusan FINAL (rantai 1 jenjang) — status Approved", approve.json?.status);
  } else {
    ok(!!approve.json?.approval, "approve jenjang manajer diterima (menunggu jenjang berikutnya)", JSON.stringify(approve.json?.approval));
    // selesaikan jenjang sisa via SERVICE (aktor admin) agar final — jalur
    // yang sama dengan yang didelegasikan endpoint ini.
    for (let guard = 0; guard < 5; guard++) {
      const res = await decideRequest(db, {
        id: leaveId, action: "approve",
        actor: { role: "ADMIN", employeeId: null, name: "E2E P3.3" },
      });
      if (!res.approval) break;
    }
  }
  const leaveDb = await db.leaveRequest.findUnique({ where: { id: leaveId } });
  ok(leaveDb?.status === "Approved", "DB: cuti bawahan status Approved", leaveDb?.status ?? "-");
  const logApprove = await db.activityLog.findFirst({
    where: { entity: "LeaveRequest", entityId: submit.docNo, action: "Approved" },
  });
  ok(!!logApprove, "ActivityLog Approved tercatat (via service reused)", logApprove?.detail?.slice(0, 70) ?? "-");

  // ================= (5) guard putus ulang / id tak dikenal =================
  console.log("\n[(5)] guard keputusan");
  const reDecide = await mgr.api("POST", TEAM_API, { kind: "leave", id: leaveId, action: "approve" });
  ok(reDecide.status === 400 || reDecide.status === 409, "putus ulang dokumen Approved → 400/409", `status=${reDecide.status}`);
  const badKind = await mgr.api("POST", TEAM_API, { kind: "ngasal", id: leaveId, action: "approve" });
  ok(badKind.status === 400, "kind tidak dikenal → 400", `status=${badKind.status}`);
  const badId = await mgr.api("POST", TEAM_API, { kind: "leave", id: "id-tidak-ada", action: "approve" });
  ok(badId.status === 400, "id tidak dikenal → 400", `status=${badId.status}`);

  // ================= (6) setelah approve: hitungan turun =================
  console.log("\n[(6)] setelah approve — pending turun");
  const team3 = await mgr.api("GET", TEAM_API);
  const pend3: any[] = team3.json?.pendingApprovals ?? [];
  ok(!pend3.some((p) => p.refNo === submit!.docNo), "dokumen TIDAK lagi di pendingApprovals");
  const meFinal = (team3.json?.members ?? []).find((x: any) => x.employeeId === pair.reportId);
  ok((meFinal?.pendingMyApprovalCount ?? -1) === baselinePending,
    "pendingMyApprovalCount bawahan kembali ke baseline", `${meFinal?.pendingMyApprovalCount} vs ${baselinePending}`);

  // ================= (7) CLEANUP =================
  console.log("\n[(7)] CLEANUP — hapus fixture (ActivityLog DIPERTAHANKAN)");
  // restore AttendanceDaily rentang cuti (approve meregen baris OnLeave).
  const afterDailies = await db.attendanceDaily.findMany({
    where: { employeeId: pair.reportId, workDate: { gte: new Date(`${leaveDate}T00:00:00`), lte: new Date(`${leaveDate}T00:00:00`) } },
  });
  const priorById = new Map(priorDailies.map((r) => [r.id, r]));
  for (const row of afterDailies) {
    const prior = priorById.get(row.id);
    if (prior) {
      await db.attendanceDaily.update({
        where: { id: row.id },
        data: {
          dayTypeId: prior.dayTypeId, state: prior.state, status: prior.status, presence: prior.presence,
          checkIn: prior.checkIn, checkOut: prior.checkOut, lateMinutes: prior.lateMinutes,
          earlyMinutes: prior.earlyMinutes, workMinutes: prior.workMinutes, normalMinutes: prior.normalMinutes,
          absenceMinutes: prior.absenceMinutes, overtimeMinutes: prior.overtimeMinutes,
          paidFlag: prior.paidFlag, notes: prior.notes, revised: prior.revised, revisedBy: prior.revisedBy,
        },
      });
    } else {
      await db.attendanceDaily.delete({ where: { id: row.id } });
    }
  }
  ok(true, `AttendanceDaily ${leaveDate} dikembalikan ke pra-uji`, `${priorDailies.length} baris pra-uji`);

  const delNotif = await db.notification.deleteMany({ where: { title: { contains: submit.docNo } } });
  const delChain = await db.approvalChain.deleteMany({ where: { docType: "Leave", docId: leaveId } });
  const delLeave = await db.leaveRequest.deleteMany({ where: { id: leaveId } });
  ok(delLeave.count === 1 && delChain.count === 1, "cuti uji + chain dihapus", `leave=${delLeave.count} chain=${delChain.count} notif=${delNotif.count}`);

  const leaveAfter = await db.leaveRequest.count();
  const chainAfter = await db.approvalChain.count({ where: { docType: "Leave" } });
  ok(leaveAfter === leaveCountBefore, "jumlah LeaveRequest kembali ke pra-uji", `${leaveAfter} vs ${leaveCountBefore}`);
  ok(chainAfter === chainCountBefore, "jumlah chain Leave kembali ke pra-uji", `${chainAfter} vs ${chainCountBefore}`);
  const logsKept = await db.activityLog.count({ where: { entity: "LeaveRequest", entityId: submit.docNo } });
  ok(logsKept >= 2, "ActivityLog uji DIPERTAHANKAN (audit trail — pola P1.x)", `${logsKept} baris`);

  console.log(`\nE2E P3.3: ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"} — mulai ${startedAt.toISOString()}`);
  await platform.$disconnect();
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
