// Uji E2E P2.6-BM (DEVELOPMENT-PLAN-BENCHMARK.md §4 P2.6, D-BM21) di atas data
// demo MII (login owner hrd@mii.co.id):
//   (1) STRUKTUR + FIELD BARU: buat ApprovalStructure docType "Loan" (kriteria
//       posisi khusus karyawan uji — tidak mengganggu struktur Loan existing)
//       dengan 1 jenjang ATASAN_LANGSUNG + escalateDays 3 via API → GET
//       mengembalikan escalateDays 3. Validasi 0/31/desimal → 400.
//   (2) ESKALASI (D-BM21 "template X=3 hari → hari ke-4 eskalasi"): chain uji
//       docId e2e-esc-test-1 (pemohon Dedi MII00009 → approver atasan Tri
//       MII00004) dibuat in-process via startApprovalChain → backdate createdAt
//       4 hari → run jobApprovalEscalation → step current berpindah ke
//       managerAtLevel(approver, 1) (Sri MII00002), label + " (eskalasi)",
//       note jejak, ActivityLog "Escalated", Notification approver baru.
//   (3) IDEMPOTEN (single-hop D-BM21): run ke-2 → tidak ada eskalasi kedua
//       (claim dedupe `escalation:chain:{id}`) — ActivityLog tetap 1 baris.
//   (4) DEFAULT OFF: struktur kedua escalateDays null + chain ke-2 backdate
//       10 hari → TIDAK tersentuh (approver tetap; tanpa klaim dedupe).
//   (5) EDGE: approver tanpa atasan (pemohon MII00002 → approver Hartono
//       MII00001 managerId null) → run tanpa error — hanya jejak "dilewati".
//   (6) CLEANUP: chains + steps + structures uji dihapus; ActivityLog
//       DIPERTAHANKAN (pola B8/e2e-p1).
// Jalankan: bun scripts/e2e-p26-escalation.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { startApprovalChain, managerAtLevel } from "@/rekankerja/shared/services/approval-engine";
import { jobApprovalEscalation } from "@/rekankerja/shared/services/approval-escalation-job";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const DAY_MS = 86_400_000;
const STRUCT_ON = "E2E-P26-ESC"; // escalateDays 3 (uji utama)
const STRUCT_OFF = "E2E-P26-OFF"; // escalateDays null (default OFF)
const STRUCT_TOP = "E2E-P26-TOP"; // escalateDays 1 (edge: approver tanpa atasan)
const DOC1 = "e2e-esc-test-1";
const DOC2 = "e2e-esc-test-2";
const DOC3 = "e2e-esc-test-3";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, detail?: string): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); }
}

const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  const list: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init?.headers ?? {}) },
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body, text };
}
const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) });
const patch = (path: string, data: unknown) => api(path, { method: "PATCH", body: JSON.stringify(data) });
const get = (path: string) => api(path);

async function login(email: string, password: string): Promise<void> {
  jar.clear();
  const r = await post("/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login ${email} ${r.status}: ${r.text.slice(0, 200)}`);
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const db = await getTenantClient(SCHEMA);

  // ================= LOGIN + FIXTURE =================
  await login(EMAIL, PASSWORD);

  const dedi = await db.employee.findUnique({ where: { employeeNo: "MII00009" } }); // pemohon uji utama
  const yusufR = await db.employee.findUnique({ where: { employeeNo: "MII00010" } }); // pemohon default-OFF
  const sri = await db.employee.findUnique({ where: { employeeNo: "MII00002" } }); // pemohon edge (atasannya Hartono MII00001 tanpa atasan)
  ok(!!dedi && !!yusufR && !!sri, "fixture karyawan uji termuat (MII00009/10/02)", `${dedi?.fullName} · ${yusufR?.fullName} · ${sri?.fullName}`);
  if (!dedi || !yusufR || !sri) throw new Error("fixture hilang — jalankan demo-seed dulu");

  const expectedApprover = await managerAtLevel(db, dedi.id, 1); // atasan Dedi = Tri (MII00004)
  const expectedSuperior = expectedApprover ? await managerAtLevel(db, expectedApprover, 1) : null; // atasan Tri = Sri (MII00002)
  ok(!!expectedApprover && !!expectedSuperior && expectedApprover !== expectedSuperior, "jenjang atasan pemohon uji tersedia (Dedi → Tri → Sri)", `${expectedApprover} → ${expectedSuperior}`);

  // ================= (1) STRUKTUR + FIELD escalateDays =================
  console.log("\n[(1)] Struktur Loan + escalateDays via API");
  const pre = await db.approvalStructure.count({ where: { code: { in: [STRUCT_ON, STRUCT_OFF, STRUCT_TOP] } } });
  if (pre > 0) {
    await db.approvalStep.deleteMany({ where: { chain: { docId: { in: [DOC1, DOC2, DOC3] } } } });
    await db.approvalChain.deleteMany({ where: { docId: { in: [DOC1, DOC2, DOC3] } } });
    await db.approvalStructureLevel.deleteMany({ where: { structure: { code: { in: [STRUCT_ON, STRUCT_OFF, STRUCT_TOP] } } } });
    await db.approvalStructure.deleteMany({ where: { code: { in: [STRUCT_ON, STRUCT_OFF, STRUCT_TOP] } } });
    console.log(`  ! sisa uji sebelumnya dibersihkan (${pre} struktur)`);
  }

  const mkStruct = await post("/api/rekankerja/approval-structures", {
    code: STRUCT_ON, name: "E2E P2.6 Eskalasi (3 hari)", docType: "Loan",
    positionId: dedi.positionId, // kriteria khusus test — hanya pemegang posisi Dedi
    levels: [{ approverType: "ATASAN_LANGSUNG" }],
    escalateDays: 3, active: true,
  });
  ok(mkStruct.status === 201, `struktur ${STRUCT_ON} dibuat (ATASAN_LANGSUNG, escalateDays 3)`, `status=${mkStruct.status} ${mkStruct.text.slice(0, 80)}`);
  const structOnId = mkStruct.body?.structure?.id;

  const getOn = await get("/api/rekankerja/approval-structures?docType=Loan");
  const onRow = (getOn.body?.structures ?? []).find((s: any) => s.code === STRUCT_ON);
  ok(!!onRow && onRow.escalateDays === 3, "GET serializer mengembalikan escalateDays 3", `escalateDays=${onRow?.escalateDays}`);

  const bad1 = await post("/api/rekankerja/approval-structures", {
    code: `${STRUCT_ON}-X`, name: "bad", docType: "Loan", levels: [{ approverType: "HR_ADMIN" }], escalateDays: 0,
  });
  ok(bad1.status === 400, "validasi: escalateDays 0 → 400", `status=${bad1.status}`);
  const bad2 = await post("/api/rekankerja/approval-structures", {
    code: `${STRUCT_ON}-X`, name: "bad", docType: "Loan", levels: [{ approverType: "HR_ADMIN" }], escalateDays: 31,
  });
  ok(bad2.status === 400, "validasi: escalateDays 31 → 400", `status=${bad2.status}`);
  const bad3 = await post("/api/rekankerja/approval-structures", {
    code: `${STRUCT_ON}-X`, name: "bad", docType: "Loan", levels: [{ approverType: "HR_ADMIN" }], escalateDays: 1.5,
  });
  ok(bad3.status === 400, "validasi: escalateDays 1,5 (bukan integer) → 400", `status=${bad3.status}`);

  // PATCH: ubah nilai (5) → GET 5; kembalikan 3.
  const pUpd = await patch(`/api/rekankerja/approval-structures?id=${structOnId}`, { escalateDays: 5 });
  ok(pUpd.status === 200, "PATCH escalateDays 5 diterima", `status=${pUpd.status} ${pUpd.text.slice(0, 60)}`);
  const pGet = await get("/api/rekankerja/approval-structures?docType=Loan");
  ok((pGet.body?.structures ?? []).find((s: any) => s.code === STRUCT_ON)?.escalateDays === 5, "GET setelah PATCH = 5");
  const pBack = await patch(`/api/rekankerja/approval-structures?id=${structOnId}`, { escalateDays: 3 });
  ok(pBack.status === 200 && (await db.approvalStructure.findUnique({ where: { id: structOnId } }))?.escalateDays === 3, "PATCH kembali 3 + persist");
  const pBad = await patch(`/api/rekankerja/approval-structures?id=${structOnId}`, { escalateDays: 0 });
  ok(pBad.status === 400, "validasi PATCH: 0 → 400", `status=${pBad.status}`);

  // ================= (2) ESKALASI HARI KE-4 =================
  console.log("\n[(2)] Eskalasi otomatis (X=3 hari → hari ke-4)");
  const chainView = await startApprovalChain(db, { docType: "Loan", docId: DOC1, employeeId: dedi.id, createdBy: "e2e-p26-escalation" });
  const chain1 = await db.approvalChain.findUnique({ where: { id: chainView.id }, include: { steps: true } });
  ok(!!chain1 && chain1.status === "InProgress" && chain1.structureId === structOnId, "chain uji via startApprovalChain → struktur uji", `struct=${chain1?.structureId === structOnId ? STRUCT_ON : chain1?.structureId}`);
  const step1Before = chain1?.steps.find((s) => s.status === "Current");
  ok(!!step1Before && step1Before.approverEmployeeId === expectedApprover, "step current = atasan pemohon (Tri MII00004)", step1Before?.approverEmployeeId);
  ok(step1Before?.approverEmployeeId != null, "step current berbasis employee (bukan posisi/HR)");

  // backdate 4 hari → lewat batas 3 hari
  await db.approvalChain.update({
    where: { id: chainView.id },
    data: { createdAt: new Date(startedAt.getTime() - 4 * DAY_MS) },
  });

  const run1 = await jobApprovalEscalation(db);
  ok(run1.escalated === 1, "run 1: escalated = 1", JSON.stringify(run1));
  ok(run1.notified >= 1, "run 1: notified ≥ 1 (approver baru)", `notified=${run1.notified}`);

  const step1After = (await db.approvalStep.findFirst({ where: { chainId: chainView.id, status: "Current" } }));
  ok(!!step1After && step1After.approverEmployeeId === expectedSuperior, "approver berubah == managerAtLevel(approver, 1) (Sri MII00002)", step1After?.approverEmployeeId);
  ok(!!step1After && step1After.approverLabel.includes("(eskalasi)"), "label memuat jejak (eskalasi)", step1After?.approverLabel);
  ok(!!step1After && /eskalasi otomatis dari .+ — melewati 3 hari tanpa keputusan/.test(step1After.note ?? ""), "note memuat jejak eskalasi", step1After?.note ?? "");

  const escLogs = await db.activityLog.findMany({
    where: { action: "Escalated", entity: "ApprovalChain", entityId: chainView.id, createdAt: { gte: startedAt } },
  });
  ok(escLogs.length === 1, "ActivityLog Escalated tepat 1 baris utk chain", `${escLogs.length} baris`);
  ok(escLogs[0]?.detail?.includes("batas 3 hari") && (escLogs[0]?.detail ?? "").length > 20, "detail ActivityLog memuat batas hari", escLogs[0]?.detail ?? "—");

  const escNotifs = await db.notification.findMany({
    where: { title: { contains: "dieskalasi" }, createdAt: { gte: startedAt } },
    select: { id: true, appUserId: true, title: true, link: true },
  });
  ok(escNotifs.length >= 1, "Notification utk approver baru ter-emisi", `${escNotifs.length} baris — "${escNotifs[0]?.title ?? ""}"`);
  const sriUsers = await db.appUser.findMany({ where: { employeeId: expectedSuperior ?? "", active: true }, select: { id: true } });
  ok(sriUsers.length === 0 || escNotifs.some((n) => sriUsers.some((u) => u.id === n.appUserId)), "penerima notifikasi mencakup AppUser approver baru (Sri)", `${sriUsers.length} AppUser Sri`);
  ok(escNotifs.every((n) => (n.link ?? "") === "actions:inbox"), "link notifikasi = actions:inbox (pola SLA job)");

  // ================= (3) IDEMPOTEN (single-hop) =================
  console.log("\n[(3)] Idempoten — dedupe satu kali per chain");
  const run2 = await jobApprovalEscalation(db);
  ok(run2.escalated === 0, "run 2: tidak ada eskalasi baru", JSON.stringify(run2));
  const step1Re = await db.approvalStep.findFirst({ where: { chainId: chainView.id, status: "Current" } });
  ok(step1Re?.approverEmployeeId === expectedSuperior, "approver tidak berubah lagi (single-hop)");
  const escLogs2 = await db.activityLog.count({ where: { action: "Escalated", entity: "ApprovalChain", entityId: chainView.id, createdAt: { gte: startedAt } } });
  ok(escLogs2 === 1, "ActivityLog Escalated tetap 1 (tidak dobel)", `${escLogs2} baris`);

  // ================= (4) DEFAULT OFF (null) =================
  console.log("\n[(4)] Default OFF — escalateDays null tidak mengubah perilaku");
  const mkOff = await post("/api/rekankerja/approval-structures", {
    code: STRUCT_OFF, name: "E2E P2.6 Default OFF", docType: "Loan",
    positionId: yusufR.positionId,
    levels: [{ approverType: "ATASAN_LANGSUNG" }],
    escalateDays: null, active: true,
  });
  ok(mkOff.status === 201, `struktur ${STRUCT_OFF} dibuat (escalateDays null)`, `status=${mkOff.status}`);
  const structOffId = mkOff.body?.structure?.id;

  const chainView2 = await startApprovalChain(db, { docType: "Loan", docId: DOC2, employeeId: yusufR.id, createdBy: "e2e-p26-escalation" });
  const chain2 = await db.approvalChain.findUnique({ where: { id: chainView2.id }, include: { steps: true } });
  const step2Before = chain2?.steps.find((s) => s.status === "Current");
  ok(!!chain2 && chain2.structureId === structOffId, "chain ke-2 memakai struktur OFF");
  await db.approvalChain.update({ where: { id: chainView2.id }, data: { createdAt: new Date(startedAt.getTime() - 10 * DAY_MS) } });

  const run3 = await jobApprovalEscalation(db);
  ok(run3.escalated === 0, "run 3 (chain backdate 10 hari, OFF): tidak tersentuh", JSON.stringify(run3));
  const step2After = await db.approvalStep.findFirst({ where: { chainId: chainView2.id, status: "Current" } });
  ok(step2After?.approverEmployeeId === step2Before?.approverEmployeeId, "approver chain OFF tetap (tidak dieskalasi)");
  const offLogs = await db.activityLog.count({ where: { action: "Escalated", entity: "ApprovalChain", entityId: chainView2.id } });
  ok(offLogs === 0, "tanpa ActivityLog Escalated utk chain OFF", `${offLogs} baris`);
  const offClaim = await db.activityLog.count({ where: { action: "Reminder", entity: "Scheduler", entityId: `escalation:chain:${chainView2.id}` } });
  ok(offClaim === 0, "chain OFF tidak pernah diklaim (tidak tersentuh sama sekali)", `${offClaim} baris`);

  // ================= (5) EDGE: approver tanpa atasan =================
  console.log("\n[(5)] Edge — approver tanpa atasan (Hartono MII00001)");
  const mkTop = await post("/api/rekankerja/approval-structures", {
    code: STRUCT_TOP, name: "E2E P2.6 Approver puncak", docType: "Loan",
    positionId: sri.positionId,
    levels: [{ approverType: "ATASAN_LANGSUNG" }],
    escalateDays: 1, active: true,
  });
  ok(mkTop.status === 201, `struktur ${STRUCT_TOP} dibuat (escalateDays 1)`, `status=${mkTop.status}`);

  const chainView3 = await startApprovalChain(db, { docType: "Loan", docId: DOC3, employeeId: sri.id, createdBy: "e2e-p26-escalation" });
  const chain3 = await db.approvalChain.findUnique({ where: { id: chainView3.id }, include: { steps: true } });
  const step3Before = chain3?.steps.find((s) => s.status === "Current");
  ok(!!step3Before && step3Before.approverEmployeeId != null, "chain edge: approver = atasan Sri (Hartono, tanpa atasan)");
  await db.approvalChain.update({ where: { id: chainView3.id }, data: { createdAt: new Date(startedAt.getTime() - 2 * DAY_MS) } });

  let run4ok = true;
  let run4: { escalated: number; notified: number } = { escalated: -1, notified: -1 };
  try {
    run4 = await jobApprovalEscalation(db);
  } catch (e) {
    run4ok = false;
    console.log("    ! error:", (e as Error).message);
  }
  ok(run4ok, "run 4 (edge): job tidak error (never-throw)");
  ok(run4.escalated === 0, "run 4: chain edge tidak dieskalasi", JSON.stringify(run4));
  const step3After = await db.approvalStep.findFirst({ where: { chainId: chainView3.id, status: "Current" } });
  ok(step3After?.approverEmployeeId === step3Before?.approverEmployeeId, "approver edge tetap (tanpa fallback sembarangan)");
  const skipLogs = await db.activityLog.findMany({
    where: { action: "Escalated", entity: "ApprovalChain", entityId: chainView3.id, createdAt: { gte: startedAt } },
  });
  ok(skipLogs.length === 1 && (skipLogs[0]?.detail ?? "").includes("dilewati"), "jejak ActivityLog 'eskalasi dilewati: atasan approver tidak ditemukan'", skipLogs[0]?.detail ?? "—");

  // ================= (6) CLEANUP =================
  console.log("\n[(6)] Cleanup — chains + steps + structures uji (ActivityLog DIPERTAHANKAN)");
  const safe = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { console.log(`    ! cleanup ${label}: ${String((e as Error)?.message ?? e).slice(0, 90)}`); }
  };
  const docIds = [DOC1, DOC2, DOC3];
  const codes = [STRUCT_ON, STRUCT_OFF, STRUCT_TOP];
  await safe("approvalSteps", () => db.approvalStep.deleteMany({ where: { chain: { docId: { in: docIds } } } }));
  await safe("approvalChains", () => db.approvalChain.deleteMany({ where: { docId: { in: docIds } } }));
  await safe("structureLevels", () => db.approvalStructureLevel.deleteMany({ where: { structure: { code: { in: codes } } } }));
  const structDel = await db.approvalStructure.deleteMany({ where: { code: { in: codes } } }).catch(() => ({ count: 0 }));
  ok(structDel.count === 3, "3 struktur uji dihapus", `${structDel.count}`);
  const leftChains = await db.approvalChain.count({ where: { docId: { in: docIds } } });
  const leftStructs = await db.approvalStructure.count({ where: { code: { in: codes } } });
  ok(leftChains === 0 && leftStructs === 0, "chain + struktur uji bersih", `chain=${leftChains} struct=${leftStructs}`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
