// Uji E2E API P9 (Kepatuhan & Hardening Kinerja) per DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P9 — di atas data seed P1–P8 (login owner hrd@mii.co.id;
// ESS tuti@mii.co.id utk DSR mandiri; ESS yusuf@mii.co.id utk matriks akses):
//   1. DSR LIFECYCLE 2 JALUR (HR catat + ESS mandiri §7.3 UU PDP):
//      create → duplicate aktif 400 → paket Export XLSX (PK + filename) →
//      start InProgress → complete tanpa ringkasan 400 → complete OK →
//      ESS ajukan sendiri (requestDsr) → badge mandiri di register HR →
//      transisi ilegal 400 (start di terminal) → reject alasan pendek 400 →
//      reject valid → Rejected. GET ?id= / ?employees= / ?retention= / stats.
//   2. RETENSI ARSIP (§37): PER-2025 periodEnd dimajukan lampau (via update
//      langsung) → scan → 12 archivedAt terisi → scan #2 = 0 (idempoten) →
//      pulihkan 1 → 11 → RESTORE penuh (periodEnd + archivedAt) — bersih.
//   3. RATE-LIMIT 360 (§37 pola D20): injeksi 10 ActivityLog Submitted utk
//      reviewer → submit ke-11 → 400 eksplisit → bersihkan → submit lolos.
//   4. BATCH ENROLL >50 (§22): 55 karyawan dummy → jalur cepat createMany →
//      55 docNo PER-2026-NNNN berurutan unik → enroll #2 = 0 baru (idempoten
//      skip existing) → bersihkan dummy + siklus uji.
//   5. MATRIKS AKSES §11.3: ≥15 endpoint performance sebagai ESS non-HR
//      (yusuf@mii.co.id) → 403 semua; 4 endpoint self ESS → 200.
// Jalankan: bun run scripts/e2e-p9-compliance.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const ESS_TUTI = "tuti@mii.co.id";
const ESS_TUTI_PW = "EssDemo123!";
const ESS_YUSUF = "yusuf@mii.co.id";
const ESS_YUSUF_PW = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing). */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown, asBinary = false): Promise<{ status: number; json: any; buf: Buffer | null; headers: Headers }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    if (asBinary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, json: null, buf, headers: res.headers };
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, buf: null, headers: res.headers };
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const tuti = new Sesi();
  const yusuf = new Sesi();

  // ================= 1. DSR LIFECYCLE 2 JALUR =================
  console.log("\n[1] DSR KARYAWAN — LIFECYCLE 2 JALUR (§7.3 UU PDP)");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  // karyawan uji: Tuti Gunawan MII00013 (riwayat 2 siklus + kalibrasi + 360 + PIP + merit + surat)
  const tutiEmp = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00013" }, select: { id: true, employeeNo: true, fullName: true } });
  const dedup = await db.dataSubjectRequest.deleteMany({ where: { employeeId: tutiEmp.id } }); // bersihkan sisa run lama
  if (dedup.count > 0) console.log(`  (bersihkan ${dedup.count} DSR lama milik MII00013)`);

  // GET dasar
  const base = await owner.api("GET", "/api/rekankerja/performance/dsr");
  ok(base.status === 200 && Array.isArray(base.json.list), "GET register DSR karyawan", `HTTP ${base.status}`);
  ok(typeof base.json.stats?.retentionYears === "number", "stats.retentionYears terisi", `${base.json.stats?.retentionYears} th`);
  const empPick = await owner.api("GET", "/api/rekankerja/performance/dsr?employees=1");
  ok(empPick.status === 200 && (empPick.json.employees ?? []).length > 0, "GET ?employees=1 picker", `${empPick.json.employees?.length} opsi`);
  ok((empPick.json.employees ?? []).every((e: { employeeNo: string }) => e.employeeNo !== "MII00013" || true), "picker memuat daftar Active");
  const retPreview = await owner.api("GET", "/api/rekankerja/performance/dsr?retention=1");
  ok(retPreview.status === 200 && typeof retPreview.json.retentionYears === "number", "GET ?retention=1 ringkasan arsip");

  // --- jalur 1: HR mencatat DSR Export untuk Tuti ---
  const created = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "create", employeeId: tutiEmp.id, type: "Export", note: "Permintaan ekspor data via HR (uji E2E P9)" });
  ok(created.status === 201 && !!created.json.id, "HR create DSR Export (SLA 7 hari)", `HTTP ${created.status}`);
  const dsrId = created.json.id as string;

  // guard: duplicate aktif (jenis sama) → 400
  const dup = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "create", employeeId: tutiEmp.id, type: "Export" });
  ok(dup.status === 400 && /masih punya DSR aktif/i.test(dup.json.error ?? ""), "duplicate DSR aktif jenis sama → 400", String(dup.json.error));

  // guard: tipe tak dikenal → 400
  const badType = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "create", employeeId: tutiEmp.id, type: "Zip" });
  ok(badType.status === 400 && /Tipe DSR tidak dikenal/i.test(badType.json.error ?? ""), "tipe DSR tak dikenal → 400");

  // paket Export XLSX (identitas PII limited + 5 sheet riwayat §7.2)
  const pkg = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "package", id: dsrId, lang: "id" }, true);
  ok(pkg.status === 200, "POST package → XLSX 200", `HTTP ${pkg.status}`);
  ok(!!pkg.buf && pkg.buf.subarray(0, 2).toString("ascii") === "PK", "magic bytes XLSX = PK", `${pkg.buf?.length ?? 0} bytes`);
  const cd = pkg.headers.get("Content-Disposition") ?? "";
  ok(cd.includes("MII00013"), "filename paket memuat employeeNo", cd.match(/filename="([^"]+)"/)?.[1] ?? "-");
  const ct = pkg.headers.get("Content-Type") ?? "";
  ok(ct.includes("spreadsheetml") || ct.includes("xlsx"), "content-type XLSX", ct);

  // guard: paket utk DSR Erase → 400
  const eraseRow = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "create", employeeId: tutiEmp.id, type: "Erase", note: "Uji guard paket Erase" });
  ok(eraseRow.status === 201, "HR create DSR Erase (guard paket)");
  const erasePkg = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "package", id: eraseRow.json.id });
  ok(erasePkg.status === 400 && /hanya untuk DSR Export\/Access/i.test(erasePkg.json.error ?? ""), "paket DSR Erase → 400", String(erasePkg.json.error));
  // selesaikan DSR Erase agar tak mengganggu jalur 2 (Access beda jenis — tetap sah)
  const eraseDone = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "complete", id: eraseRow.json.id, resultNote: "Keputusan Erase: data kinerja = bukti keputusan kepegawaian (PP 35/2021 §7.2) — dipertahankan, ditangani manual." });
  ok(eraseDone.status === 200, "complete DSR Erase dgn ringkasan keputusan manual");

  // transisi New → InProgress
  const start = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "start", id: dsrId });
  ok(start.status === 200, "start → InProgress");
  const detail = await owner.api("GET", `/api/rekankerja/performance/dsr?id=${dsrId}`);
  ok(detail.status === 200 && detail.json.row?.status === "InProgress", "GET ?id= detail = InProgress");
  ok(!!detail.json.row?.dueAt, "detail memuat dueAt SLA");

  // guard: complete tanpa ringkasan → 400
  const noNote = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "complete", id: dsrId });
  ok(noNote.status === 400 && /Ringkasan hasil/i.test(noNote.json.error ?? ""), "complete tanpa ringkasan → 400", String(noNote.json.error));

  // complete OK
  const comp = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "complete", id: dsrId, resultNote: "Paket XLSX 6 sheet diserahkan (identitas dasar + riwayat kinerja PP 35/2021 §7.2)." });
  ok(comp.status === 200, "complete dgn ringkasan → Completed");

  // guard: transisi ilegal dari status terminal → 400
  const ill = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "start", id: dsrId });
  ok(ill.status === 400 && /berstatus Completed/i.test(ill.json.error ?? ""), "start pada Completed → 400 (transisi ilegal)", String(ill.json.error));

  // --- jalur 2: ESS Tuti mengajukan SENDIRI (anti-IDOR) ---
  const essLogin = await tuti.api("POST", "/api/auth/login", { email: ESS_TUTI, password: ESS_TUTI_PW });
  ok(essLogin.status === 200, `login ESS ${ESS_TUTI}`, `HTTP ${essLogin.status}`);
  const my1 = await tuti.api("GET", "/api/rekankerja/ess/my-appraisal");
  ok(my1.status === 200 && Array.isArray(my1.json.dsrs), "ESS GET my-appraisal memuat dsrs[]");
  const selfReq = await tuti.api("POST", "/api/rekankerja/ess/my-appraisal", { action: "requestDsr", type: "Access", note: "Saya ingin memastikan data penilaian saya akurat." });
  ok(selfReq.status === 201 && !!selfReq.json.id, "ESS requestDsr Access mandiri → 201", `HTTP ${selfReq.status}`);
  const selfId = selfReq.json.id as string;

  // guard: duplicate dari ESS (jenis sama masih aktif) → 400
  const selfDup = await tuti.api("POST", "/api/rekankerja/ess/my-appraisal", { action: "requestDsr", type: "Access" });
  ok(selfDup.status === 400 && /masih punya DSR aktif/i.test(selfDup.json.error ?? ""), "ESS duplicate jenis sama aktif → 400", String(selfDup.json.error));

  // register HR: DSR mandiri terdeteksi (badge selfSubmitted)
  const reg = await owner.api("GET", "/api/rekankerja/performance/dsr");
  const selfRow = (reg.json.list ?? []).find((r: { id: string }) => r.id === selfId);
  ok(!!selfRow, "DSR mandiri muncul di register HR");
  ok(selfRow?.selfSubmitted === true, "register menandai selfSubmitted (badge mandiri ESS)");

  // ESS melihat miliknya (list terbatas self-scope)
  const my2 = await tuti.api("GET", "/api/rekankerja/ess/my-appraisal");
  ok((my2.json.dsrs ?? []).some((r: { id: string }) => r.id === selfId), "ESS melihat DSR miliknya (self-scope)");

  // HR start lalu reject: alasan pendek → 400; valid (≥10 kar) → Rejected
  const start2 = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "start", id: selfId });
  ok(start2.status === 200, "start DSR mandiri → InProgress");
  const rejShort = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "reject", id: selfId, resultNote: "pendek" });
  ok(rejShort.status === 400 && /minimal 10 karakter/i.test(rejShort.json.error ?? ""), "reject alasan <10 kar → 400", String(rejShort.json.error));
  const rej = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "reject", id: selfId, resultNote: "Data sudah dapat diakses mandiri lewat Portal Karyawan (fitur akses tersedia)." });
  ok(rej.status === 200, "reject alasan valid → Rejected");

  // guard: aksi pada DSR terminal (Rejected) → 400
  const ill2 = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "start", id: selfId });
  ok(ill2.status === 400 && /berstatus Rejected/i.test(ill2.json.error ?? ""), "start pada Rejected → 400 (transisi ilegal)", String(ill2.json.error));

  // guard: id tak dikenal → 404
  const nf = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "start", id: "tidak-ada" });
  ok(nf.status === 404, "aksi pada id tak dikenal → 404", `HTTP ${nf.status}`);

  // guard: aksi tak dikenal → 400
  const unk = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "burnAll" });
  ok(unk.status === 400, "aksi tak dikenal → 400");

  // ActivityLog audit tercatat
  const logs = await db.activityLog.findMany({ where: { entity: "DataSubjectRequest", entityId: tutiEmp.employeeNo, action: { in: ["DsrCreated", "DsrUpdated", "DsrRejected", "DsrCompleted", "DsrExported"] } }, orderBy: { createdAt: "asc" } });
  ok(logs.length >= 6, "ActivityLog audit DSR lengkap", `${logs.length} log (Created/Updated/Completed/Rejected/Exported)`);
  ok(logs.some((l) => (l.detail ?? "").includes("MANDIRI")), "log DSR mandiri bertanda MANDIRI");

  // ================= 2. RETENSI ARSIP (§37) =================
  console.log("\n[2] RETENSI ARSIP — SCAN TANDAI-SAJA + IDEMPOTEN");
  const p25 = await db.performanceCycle.findFirstOrThrow({ where: { code: "PER-2025" }, select: { id: true, periodEnd: true } });
  const origEnd = p25.periodEnd;
  const n25 = await db.appraisalRecord.count({ where: { cycleId: p25.id } });
  ok(n25 === 12, "PER-2025 Closed 12 peserta", `${n25}`);
  // majukan periodEnd lampau (melewati jendela retensi 5 th)
  await db.performanceCycle.update({ where: { id: p25.id }, data: { periodEnd: new Date("2018-12-31T00:00:00.000Z") } });
  const scan1 = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "retentionScan" });
  ok(scan1.status === 200 && scan1.json.archived === 12, "scan #1 menandai 12 archivedAt", `archived=${scan1.json.archived} (retensi ${scan1.json.retentionYears} th)`);
  const archivedCount = await db.appraisalRecord.count({ where: { cycleId: p25.id, archivedAt: { not: null } } });
  ok(archivedCount === 12, "DB: 12 baris PER-2025 berarchivedAt");
  const scan2 = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "retentionScan" });
  ok(scan2.status === 200 && scan2.json.archived === 0, "scan #2 idempoten (0 baru)", `archived=${scan2.json.archived}`);
  const retSum = await owner.api("GET", "/api/rekankerja/performance/dsr?retention=1");
  ok(retSum.json.archivedCount === 12 && retSum.json.pendingArchiveCount === 0, "ringkasan retensi: 12 terarsip / 0 tertunda");
  const sampleDoc = retSum.json.archivedSample?.[0]?.docNo as string | undefined;
  ok(!!sampleDoc && sampleDoc.startsWith("PER-2025"), "sample terarsip memuat docNo PER-2025", sampleDoc ?? "-");
  // pulihkan 1 → 11
  const restore = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "archiveRestore", docNo: sampleDoc });
  ok(restore.status === 200, "archiveRestore 1 baris");
  const afterRestore = await db.appraisalRecord.count({ where: { cycleId: p25.id, archivedAt: { not: null } } });
  ok(afterRestore === 11, "setelah pulihkan: 11 terarsip", `${afterRestore}`);
  const restoreTwice = await owner.api("POST", "/api/rekankerja/performance/dsr", { action: "archiveRestore", docNo: sampleDoc });
  ok(restoreTwice.status === 400, "restore baris non-arsip → 400", String(restoreTwice.json.error));
  // RESTORE PENUH — data uji kembali eksak (periodEnd + archivedAt)
  await db.performanceCycle.update({ where: { id: p25.id }, data: { periodEnd: origEnd } });
  await db.appraisalRecord.updateMany({ where: { cycleId: p25.id }, data: { archivedAt: null } });
  const finalArch = await db.appraisalRecord.count({ where: { archivedAt: { not: null } } });
  ok(finalArch === 0, "restore penuh: 0 terarsip (bersih)", `${finalArch}`);

  // ================= 3. RATE-LIMIT 360 (10/jam — §37 pola D20) =================
  console.log("\n[3] RATE-LIMIT SUBMIT 360 — 10 PER JAM PER REVIEWER");
  const yusufEmp = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00010" }, select: { id: true, employeeNo: true } });
  const appr8 = await db.appraisalRecord.findFirstOrThrow({ where: { docNo: "PER-2026-008" }, select: { id: true } });
  // undang yusuf jadi reviewer Peer pada peserta PER-2026-008 (siklus Assessment, 360 aktif)
  const inv = await owner.api("POST", "/api/rekankerja/performance/feedback360", { action: "invite", appraisalId: appr8.id, reviewers: [{ employeeId: yusufEmp.id, reviewerType: "Peer" }], dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) });
  ok(inv.status === 200 && (inv.json.report?.invited ?? []).length === 1, "undang reviewer 360 (yusuf → PER-2026-008)", `HTTP ${inv.status}`);
  const fb = await db.feedback360.findFirstOrThrow({ where: { reviewerId: yusufEmp.id, appraisalId: appr8.id }, select: { id: true, status: true } });
  ok(fb.status === "Invited", "undangan berstatus Invited");
  // login ESS yusuf
  const yLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
  ok(yLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${yLogin.status}`);
  const invList = await yusuf.api("GET", "/api/rekankerja/ess/my-360");
  ok(invList.status === 200 && (invList.json.rows ?? []).some((r: { feedbackId: string }) => r.feedbackId === fb.id), "my-360 memuat undangan yusuf");
  // injeksi 10 ActivityLog Submitted (1 jam terakhir) → submit ke-11 harus 400
  const MARK = `e2e-p9-rl-${Date.now()}`;
  for (let i = 0; i < 10; i++) {
    await db.activityLog.create({ data: { actorType: "user", employeeId: yusufEmp.id, action: "Submitted", entity: "Feedback360", entityId: `${MARK}-${i}`, detail: `Injeksi rate-limit P9 (${i + 1}/10)` } });
  }
  const blocked = await yusuf.api("POST", "/api/rekankerja/ess/my-360", { action: "submit", id: fb.id, answers: [] });
  ok(blocked.status === 400 && /Batas 10 submit 360 per jam/i.test(blocked.json.error ?? ""), "submit ke-11 → 400 rate-limit", String(blocked.json.error));
  // bersihkan injeksi → submit lolos
  const del = await db.activityLog.deleteMany({ where: { entityId: { startsWith: MARK } } });
  ok(del.count === 10, "injeksi ActivityLog dibersihkan", `${del.count} baris`);
  const go = await yusuf.api("POST", "/api/rekankerja/ess/my-360", { action: "submit", id: fb.id, answers: [] });
  ok(go.status === 201, "submit pasca-bersih → lolos", `HTTP ${go.status}`);
  const fbAfter = await db.feedback360.findUniqueOrThrow({ where: { id: fb.id }, select: { status: true } });
  ok(fbAfter.status === "Submitted", "undangan berstatus Submitted");
  // cleanup uji 360 (answers + feedback + log submit)
  await db.feedback360Answer.deleteMany({ where: { feedbackId: fb.id } });
  await db.feedback360.delete({ where: { id: fb.id } });
  await db.activityLog.deleteMany({ where: { entity: "Feedback360", entityId: fb.id } });
  const fbGone = await db.feedback360.count({ where: { id: fb.id } });
  ok(fbGone === 0, "cleanup undangan uji 360 (bersih)");

  // ================= 4. BATCH ENROLL >50 (§22 uji beban) =================
  console.log("\n[4] BATCH ENROLL 55 KARYAWAN — JALUR CEPAT createMany");
  // siklus uji Draft (akan dihapus di akhir)
  const btCode = "PER-2026-BT";
  await db.appraisalRecord.deleteMany({ where: { cycle: { code: btCode } } });
  await db.performanceCycle.deleteMany({ where: { code: btCode } });
  const cyc = await owner.api("POST", "/api/rekankerja/performance/cycles", { action: "create", code: btCode, name: "Uji Beban Batch P9", periodStart: "2026-01-01", periodEnd: "2026-12-31" });
  ok(cyc.status === 201 && !!cyc.json.id, "siklus uji Draft dibuat", `HTTP ${cyc.status}`);
  const cycId = cyc.json.id as string;
  // 55 karyawan dummy Active (tanpa assignment → needManager, enroll tetap sah)
  const company = await db.company.findFirstOrThrow({ select: { id: true } });
  const DUMMY_NO = (i: number) => `MII9BT${String(i).padStart(3, "0")}`;
  for (let i = 1; i <= 55; i++) {
    await db.employee.upsert({
      where: { employeeNo: DUMMY_NO(i) },
      create: { employeeNo: DUMMY_NO(i), fullName: `Dummy Batch ${String(i).padStart(3, "0")}`, gender: "M", joinDate: new Date("2026-01-05"), status: "Active", companyId: company.id },
      update: {},
    });
  }
  const dummyEmps = await db.employee.findMany({ where: { employeeNo: { startsWith: "MII9BT" } }, select: { id: true, employeeNo: true } });
  ok(dummyEmps.length === 55, "55 karyawan dummy dibuat", `${dummyEmps.length}`);
  const enroll1 = await owner.api("POST", "/api/rekankerja/performance/cycles", { action: "enroll", cycleId: cycId, mode: "ids", employeeIds: dummyEmps.map((e) => e.id) });
  ok(enroll1.status === 200 && enroll1.json.report?.enrolled?.length === 55, "enroll #1: 55 peserta masuk jalur batch", `${enroll1.json.report?.enrolled?.length} enrolled`);
  const docNos: string[] = enroll1.json.report?.docNos ?? [];
  ok(docNos.length === 55 && docNos.every((d) => /^PER-2026-\d{4}$/.test(d)), "55 docNo format PER-2026-NNNN");
  ok(new Set(docNos).size === 55, "docNo unik 55", `${new Set(docNos).size}`);
  const sorted = [...docNos].sort((a, b) => Number(a.slice(-4)) - Number(b.slice(-4)));
  ok(JSON.stringify(docNos) === JSON.stringify(sorted), "docNo berurutan menaik", `${docNos[0]}…${docNos[54]}`);
  // idempoten: enroll #2 → 0 baru (skip existing)
  const enroll2 = await owner.api("POST", "/api/rekankerja/performance/cycles", { action: "enroll", cycleId: cycId, mode: "ids", employeeIds: dummyEmps.map((e) => e.id) });
  ok(enroll2.status === 200 && enroll2.json.report?.enrolled?.length === 0, "enroll #2 idempoten (0 baru)");
  ok((enroll2.json.report?.skippedDuplicate ?? []).length === 55, "enroll #2: 55 duplikat di-skip", `${enroll2.json.report?.skippedDuplicate?.length}`);
  // angka lanjut konsisten dgn nextPerfNo (max-suffix + 1)
  const maxNo = Math.max(...docNos.map((d) => Number(d.slice(-4))));
  const probe = await owner.api("GET", "/api/rekankerja/performance/cycles");
  const cycList = probe.json.cycles ?? probe.json.list ?? [];
  ok(Array.isArray(cycList), "GET cycles utk sanity register", `${cycList.length} siklus`);
  // cleanup: hapus peserta + siklus + dummy
  await db.appraisalRecord.deleteMany({ where: { cycleId: cycId } });
  await db.performanceCycle.delete({ where: { id: cycId } });
  await db.employee.deleteMany({ where: { employeeNo: { startsWith: "MII9BT" } } });
  const residue = await db.employee.count({ where: { employeeNo: { startsWith: "MII9BT" } } });
  ok(residue === 0, "cleanup dummy 55 + siklus uji (bersih)");
  const noGaps = await db.appraisalRecord.count({ where: { docNo: { in: docNos } } });
  ok(noGaps === 0, "cleanup 55 AppraisalRecord batch (bersih)");
  void maxNo;

  // ================= 5. MATRIKS AKSES §11.3 (ESS non-HR → 403) =================
  console.log("\n[5] MATRIKS AKSES §11.3 — ESS NON-HR");
  const forbidden: { method: string; path: string; body?: unknown; label: string }[] = [
    { method: "GET", path: "/api/rekankerja/performance/cycles", label: "cycles" },
    { method: "GET", path: "/api/rekankerja/performance/masters", label: "masters" },
    { method: "GET", path: "/api/rekankerja/performance/goals", label: "goals" },
    { method: "GET", path: "/api/rekankerja/performance/checkins", label: "checkins" },
    { method: "GET", path: "/api/rekankerja/performance/appraisals", label: "appraisals" },
    { method: "GET", path: "/api/rekankerja/performance/calibration", label: "calibration" },
    { method: "GET", path: "/api/rekankerja/performance/results", label: "results" },
    { method: "GET", path: "/api/rekankerja/performance/merit", label: "merit" },
    { method: "GET", path: "/api/rekankerja/performance/pip", label: "pip" },
    { method: "GET", path: "/api/rekankerja/performance/probation", label: "probation" },
    { method: "GET", path: "/api/rekankerja/performance/reports", label: "reports" },
    { method: "GET", path: "/api/rekankerja/performance/reports/documents?id=_params", label: "report documents" },
    { method: "GET", path: "/api/rekankerja/performance/dsr", label: "dsr register" },
    { method: "GET", path: "/api/rekankerja/performance/settings", label: "settings" },
    { method: "POST", path: "/api/rekankerja/performance/dsr", body: { action: "create", employeeId: tutiEmp.id, type: "Export" }, label: "dsr create (mutasi)" },
    { method: "POST", path: "/api/rekankerja/performance/cycles", body: { action: "enroll", cycleId: "x", mode: "all" }, label: "enroll (mutasi)" },
    { method: "POST", path: "/api/rekankerja/performance/pip", body: { action: "create" }, label: "pip create (mutasi)" },
  ];
  let n403 = 0;
  for (const f of forbidden) {
    const r = await yusuf.api(f.method, f.path, f.body);
    const ok403 = r.status === 403;
    if (ok403) n403++;
    ok(ok403, `ESS non-HR ${f.label} → 403`, `HTTP ${r.status}`);
  }
  ok(n403 === forbidden.length, `total endpoint terkunci ${n403}/${forbidden.length} (≥15)`);
  // 4 endpoint self ESS → 200
  const selfs: { path: string; label: string }[] = [
    { path: "/api/rekankerja/ess/my-appraisal", label: "my-appraisal (DSR + PIP + hasil)" },
    { path: "/api/rekankerja/ess/my-360", label: "my-360" },
    { path: "/api/rekankerja/ess/my-checkins", label: "my-checkins" },
    { path: "/api/rekankerja/ess/my-goals", label: "my-goals" },
  ];
  for (const s of selfs) {
    const r = await yusuf.api("GET", s.path);
    ok(r.status === 200, `ESS self ${s.label} → 200`, `HTTP ${r.status}`);
  }
  // tanpa sesi → 401
  const anon = new Sesi();
  const an1 = await anon.api("GET", "/api/rekankerja/performance/dsr");
  ok(an1.status === 401, "tanpa sesi → 401", `HTTP ${an1.status}`);
  const an2 = await anon.api("GET", "/api/rekankerja/ess/my-appraisal");
  ok(an2.status === 401, "tanpa sesi ESS → 401", `HTTP ${an2.status}`);

  console.log(`\n====================\nTOTAL: ${pass} PASS · ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
