// Uji E2E P3.1 (Job architecture — DEVELOPMENT-PLAN-BENCHMARK.md §2 D-BM23 +
// §4 Fase P3.1) — di atas data demo MII:
//   (0) SETUP: login HR owner + snapshot pra-uji + pre-clean artefak run lama.
//   (1) FAMILY TREE: buat root + sub-family → GET tree memuat children;
//       ActivityLog Created.
//   (2) GUARD DEPTH-2: cucu (child-of-child) → 400; pindah family ber-anak →
//       400; self-parent → 400; kode duplikat → 400; update family OK.
//   (3) JOB PROFILE: buat job dgn family + mission + duties + qualifications +
//       minEducation + workingConditions → GET persist round-trip (dutiesJson
//       array) + ActivityLog Created.
//   (4) UPDATE PROFILE: PATCH ganti family/mission/duties/minEducation →
//       persist + ActivityLog Updated.
//   (5) VALIDASI: mission >2000 → 400; item duties >500 → 400; >20 item → 400;
//       minEducation ilegal → 400; familyId tak-ada → 400.
//   (6) GUARD HAPUS FAMILY: family dgn job teraut → 400; family dgn sub-family
//       → 400.
//   (7) BACKFILL MII INTACT: minimal satu job seeded tetap familyId non-null.
//   (8) EXPORT XLSX: struktur jabatan → PK + >1000 byte + content-type + parse
//       exceljs (judul, header ID & EN via BASE_EN, baris job seeded) +
//       ActivityLog Exported.
//   (9) MENU GUARD: ESS (role ESS-only) GET/POST job-families → 403.
//  (10) CLEANUP: hapus job uji → hapus sub-family → hapus root; verifikasi
//       bersih + jumlah family kembali ke pra-uji (ActivityLog DIPERTAHANKAN).
// Jalankan: bun scripts/e2e-p31-jobarch.ts
import "./lib/env";
import * as ExcelJS from "exceljs";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const ESS_EMAIL = "yusuf@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const FAM_API = "/api/rekankerja/job-families";
const JOB_API = "/api/rekankerja/jobs";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) + dukungan binary — pola e2e-b5. */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown, asBinary = false): Promise<{ status: number; json: any; buf: Buffer | null; headers: Headers; text: string }> {
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
        if (asBinary) {
          const buf = Buffer.from(await res.arrayBuffer());
          return { status: res.status, json: null, buf, headers: res.headers, text: "" };
        }
        const text = await res.text();
        let json: any = {};
        try { json = JSON.parse(text); } catch { /* keep */ }
        return { status: res.status, json, buf: null, headers: res.headers, text };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const ess = new Sesi();
  const startedAt = new Date();
  const N = Date.now().toString(36).toUpperCase().slice(-6);
  const ROOT_CODE = `JF-E2E31-ROOT-${N}`;
  const CHILD_CODE = `JF-E2E31-CHILD-${N}`;
  const JOB_CODE = `E2E31-JOB-${N}`;

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + snapshot + pre-clean artefak run lama");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  const famCountBefore = await db.jobFamily.count();
  const jobCountBefore = await db.job.count();
  const staleFam = await db.jobFamily.deleteMany({ where: { OR: [{ code: { startsWith: "JF-E2E31-" } }, { name: { startsWith: "E2e31" } }] } });
  const staleJobs = await db.job.deleteMany({ where: { code: { startsWith: "E2E31-JOB-" } } });
  if (staleFam.count > 0 || staleJobs.count > 0) {
    console.log(`  pre-clean: ${staleFam.count} family + ${staleJobs.count} job run lama dihapus`);
  }
  ok(true, "pre-clean idempoten selesai", `${famCountBefore} family · ${jobCountBefore} job pra-uji`);

  // ================= (1) FAMILY TREE =================
  console.log("\n[(1)] FAMILY TREE — buat root + sub-family (D-BM23)");
  const cRoot = await hr.api("POST", FAM_API, { code: ROOT_CODE, name: `E2e31 Root ${N}`, sortOrder: 5 });
  ok(cRoot.status === 201 && cRoot.json?.family?.id, "POST buat family root → 201", `HTTP ${cRoot.status} ${cRoot.json?.family?.code ?? cRoot.json?.error ?? ""}`);
  const rootId: string = cRoot.json?.family?.id ?? "";
  ok(typeof rootId === "string" && rootId.length > 0, "root id terisi");

  const cChild = await hr.api("POST", FAM_API, { code: CHILD_CODE, name: `E2e31 Child ${N}`, parentId: rootId, sortOrder: 2 });
  ok(cChild.status === 201 && cChild.json?.family?.id, "POST buat sub-family di bawah root → 201", `HTTP ${cChild.status}`);
  const childId: string = cChild.json?.family?.id ?? "";

  const list1 = await hr.api("GET", FAM_API);
  ok(list1.status === 200, "GET job-families → 200", `HTTP ${list1.status}`);
  const root1 = (list1.json?.families ?? []).find((f: any) => f.id === rootId);
  ok(!!root1, "root muncul di daftar tree");
  ok(root1?.children?.some((c: any) => c.id === childId), "sub-family muncul sbg children root (tree 2-level)");
  ok(root1?.jobCount === 0, "root jobCount = 0 (belum ada job)");

  const logCreate = await db.activityLog.findFirst({
    where: { entity: "JobFamily", entityId: rootId, action: "Created" },
    select: { detail: true, appUserId: true },
  });
  ok(!!logCreate, "ActivityLog Created (JobFamily root) tertulis");
  ok(!!logCreate?.appUserId, "ActivityLog memuat aktor (appUserId)", String(logCreate?.appUserId ?? "—"));

  // ================= (2) GUARD DEPTH-2 + UPDATE FAMILY =================
  console.log("\n[(2)] GUARD DEPTH — maksimal 2 tingkat");
  const gGrand = await hr.api("POST", FAM_API, { code: `JF-E2E31-GRAND-${N}`, name: "E2e31 Grandchild", parentId: childId });
  ok(gGrand.status === 400, "buat cucu (child-of-child) → 400", `HTTP ${gGrand.status} — ${String(gGrand.json?.error ?? "").slice(0, 60)}`);
  const grandCount = await db.jobFamily.count({ where: { code: { startsWith: "JF-E2E31-GRAND" } } });
  ok(grandCount === 0, "cucu TIDAK tersimpan");

  const otherRoot = await hr.api("POST", FAM_API, { code: `JF-E2E31-OTHER-${N}`, name: `E2e31 Other ${N}` });
  const otherRootId: string = otherRoot.json?.family?.id ?? "";
  ok(otherRoot.status === 201, "root lain uji pindah dibuat", `HTTP ${otherRoot.status}`);
  const gMove = await hr.api("PATCH", FAM_API, { id: rootId, parentId: otherRootId });
  ok(gMove.status === 400, "pindahkan root yang punya sub-family → 400", `HTTP ${gMove.status}`);
  const gSelf = await hr.api("PATCH", FAM_API, { id: rootId, parentId: rootId });
  ok(gSelf.status === 400, "parent = diri sendiri → 400", `HTTP ${gSelf.status}`);
  const gDup = await hr.api("POST", FAM_API, { code: ROOT_CODE, name: "Duplikat" });
  ok(gDup.status === 400, "kode family duplikat → 400", `HTTP ${gDup.status}`);

  const uChild = await hr.api("PATCH", FAM_API, { id: childId, name: `E2e31 Child Renamed ${N}`, sortOrder: 7 });
  ok(uChild.status === 200 && uChild.json?.family?.name?.includes("Renamed"), "PATCH rename sub-family + sortOrder → 200", `HTTP ${uChild.status}`);
  const logUpdFam = await db.activityLog.findFirst({ where: { entity: "JobFamily", entityId: childId, action: "Updated" } });
  ok(!!logUpdFam, "ActivityLog Updated (JobFamily) tertulis");

  // ================= (3) JOB PROFILE =================
  console.log("\n[(3)] JOB PROFILE — job + family + mission/duties/qualifications/education/conditions");
  const MISSION = `E2e31 mission — mengelola arsitektur jabatan tenant demo dengan cermat (${N}).`;
  const DUTIES = [
    "Menyusun peta family jabatan dua tingkat",
    "Memelihara job profile (mission, duties, qualifications)",
    "Menjaga konsistensi kode family JF-<SLUG>",
  ];
  const QUALS = ["S1 Manajemen atau setara", "Pengalaman HRIS minimal 2 tahun"];
  const cJob = await hr.api("POST", JOB_API, {
    code: JOB_CODE,
    title: `E2e31 Job Architecture Specialist ${N}`,
    category: "Staff",
    familyId: childId,
    description: "Job uji e2e P3.1",
    mission: MISSION,
    duties: DUTIES,
    qualifications: QUALS,
    minEducation: "S1",
    workingConditions: "Kantor pusat, jam kerja normal, WFH 1 hari/pekan",
  });
  ok(cJob.status === 201 && cJob.json?.job?.id, "POST job + profil lengkap → 201", `HTTP ${cJob.status} ${cJob.json?.error ?? ""}`);
  const jobId: string = cJob.json?.job?.id ?? "";

  const jobRow = await db.job.findUnique({
    where: { id: jobId },
    select: { familyId: true, mission: true, dutiesJson: true, qualificationsJson: true, minEducation: true, workingConditions: true },
  });
  ok(jobRow?.familyId === childId, "familyId tersimpan (job → sub-family)");
  ok(jobRow?.mission === MISSION, "mission persist", (jobRow?.mission ?? "").slice(0, 40));
  const dutiesParsed = JSON.parse(jobRow?.dutiesJson ?? "[]");
  ok(Array.isArray(dutiesParsed) && dutiesParsed.length === 3 && dutiesParsed[0] === DUTIES[0], "dutiesJson round-trip array 3 item");
  const qualsParsed = JSON.parse(jobRow?.qualificationsJson ?? "[]");
  ok(Array.isArray(qualsParsed) && qualsParsed.length === 2 && qualsParsed[1] === QUALS[1], "qualificationsJson round-trip array 2 item");
  ok(jobRow?.minEducation === "S1", "minEducation = S1");
  ok(!!jobRow?.workingConditions?.includes("WFH"), "workingConditions persist");

  // GET memuat family utk kolom tabel + filter UI.
  const jobsGet = await hr.api("GET", JOB_API);
  const jobApiRow = (jobsGet.json?.jobs ?? []).find((j: any) => j.id === jobId);
  ok(jobsGet.status === 200 && jobApiRow?.family?.id === childId && !!jobApiRow?.family?.name?.includes("Renamed"), "GET jobs memuat family (kolom tabel UI)", jobApiRow?.family?.code ?? "—");

  const list2 = await hr.api("GET", FAM_API);
  const child2 = (list2.json?.families ?? []).flatMap((f: any) => f.children).find((c: any) => c.id === childId);
  ok(child2?.jobCount === 1, "tree jobCount sub-family = 1 setelah job teraut");

  const logJobCreate = await db.activityLog.findFirst({ where: { entity: "Job", entityId: jobId, action: "Created" } });
  ok(!!logJobCreate, "ActivityLog Created (Job) tertulis");

  // ================= (4) UPDATE PROFILE =================
  console.log("\n[(4)] UPDATE JOB PROFILE — pindah family + ubah field profil");
  const MISSION2 = `E2e31 mission v2 — diperbarui oleh e2e P3.1 (${N}).`;
  const uJob = await hr.api("PATCH", JOB_API, {
    id: jobId,
    familyId: rootId,
    mission: MISSION2,
    duties: ["Satu tugas revisi"],
    qualifications: ["Kualifikasi revisi"],
    minEducation: "S2",
    workingConditions: "Hybrid penuh",
  });
  ok(uJob.status === 200, "PATCH job profile → 200", `HTTP ${uJob.status} ${uJob.json?.error ?? ""}`);
  const jobRow2 = await db.job.findUnique({
    where: { id: jobId },
    select: { familyId: true, mission: true, dutiesJson: true, qualificationsJson: true, minEducation: true, workingConditions: true },
  });
  ok(jobRow2?.familyId === rootId, "familyId pindah ke root");
  ok(jobRow2?.mission === MISSION2, "mission terbarui");
  ok(JSON.parse(jobRow2?.dutiesJson ?? "[]").length === 1, "duties terbarui jadi 1 item");
  ok(jobRow2?.minEducation === "S2" && jobRow2?.workingConditions === "Hybrid penuh", "minEducation S2 + workingConditions terbarui");
  const logJobUpd = await db.activityLog.findFirst({ where: { entity: "Job", entityId: jobId, action: "Updated" } });
  ok(!!logJobUpd, "ActivityLog Updated (Job) tertulis");

  // ================= (5) VALIDASI FIELD PROFIL =================
  console.log("\n[(5)] VALIDASI — batas panjang & daftar");
  const vMission = await hr.api("PATCH", JOB_API, { id: jobId, mission: "x".repeat(2001) });
  ok(vMission.status === 400, "mission > 2000 karakter → 400", `HTTP ${vMission.status}`);
  const vWc = await hr.api("PATCH", JOB_API, { id: jobId, workingConditions: "y".repeat(2001) });
  ok(vWc.status === 400, "workingConditions > 2000 karakter → 400", `HTTP ${vWc.status}`);
  const vDutyItem = await hr.api("PATCH", JOB_API, { id: jobId, duties: ["z".repeat(501)] });
  ok(vDutyItem.status === 400, "item duties > 500 karakter → 400", `HTTP ${vDutyItem.status}`);
  const vDutyCount = await hr.api("PATCH", JOB_API, { id: jobId, duties: Array.from({ length: 21 }, (_, i) => `duty ${i}`) });
  ok(vDutyCount.status === 400, "duties > 20 item → 400", `HTTP ${vDutyCount.status}`);
  const vEdu = await hr.api("PATCH", JOB_API, { id: jobId, minEducation: "S9" });
  ok(vEdu.status === 400, "minEducation di luar daftar → 400", `HTTP ${vEdu.status}`);
  const vFam = await hr.api("PATCH", JOB_API, { id: jobId, familyId: "family-yang-tidak-ada" });
  ok(vFam.status === 400, "familyId tak dikenal → 400", `HTTP ${vFam.status}`);

  // ================= (6) GUARD HAPUS FAMILY =================
  console.log("\n[(6)] GUARD HAPUS — job teraut / sub-family");
  // pindahkan job kembali ke child supaya guard teruji dari kedua sisi.
  await hr.api("PATCH", JOB_API, { id: jobId, familyId: childId });
  const dChildWithJob = await hr.api("DELETE", `${FAM_API}?id=${encodeURIComponent(childId)}`);
  ok(dChildWithJob.status === 400, "hapus sub-family yang masih dipakai job → 400", `HTTP ${dChildWithJob.status} — ${String(dChildWithJob.json?.error ?? "").slice(0, 70)}`);
  const dRootWithChild = await hr.api("DELETE", `${FAM_API}?id=${encodeURIComponent(rootId)}`);
  ok(dRootWithChild.status === 400, "hapus root yang masih punya sub-family → 400", `HTTP ${dRootWithChild.status} — ${String(dRootWithChild.json?.error ?? "").slice(0, 70)}`);
  const famStill = await db.jobFamily.count({ where: { id: { in: [rootId, childId] } } });
  ok(famStill === 2, "kedua family tetap ada (guard menolak)");

  // ================= (7) BACKFILL MII INTACT =================
  console.log("\n[(7)] BACKFILL — kategori → family (migrasi P3-0) tetap utuh");
  const seededWithFamily = await db.job.findFirst({
    where: { familyId: { not: null }, code: { not: { startsWith: "E2E31-" } } },
    select: { code: true, familyId: true, family: { select: { code: true } } },
  });
  ok(!!seededWithFamily, "minimal satu job seeded tetap teraut family (backfill intact)", `${seededWithFamily?.code} → ${seededWithFamily?.family?.code}`);
  const countSeeded = await db.job.count({ where: { familyId: { not: null }, code: { not: { startsWith: "E2E31-" } } } });
  ok(countSeeded >= 16, `job seeded teraut family ≥ 16`, `${countSeeded} job`);

  // ================= (8) EXPORT XLSX =================
  console.log("\n[(8)] EXPORT XLSX — laporan struktur jabatan");
  const xls = await hr.api("GET", `${FAM_API}?export=xlsx`, undefined, true);
  ok(xls.status === 200, "GET ?export=xlsx → 200", `HTTP ${xls.status}`);
  ok((xls.headers.get("content-type") ?? "").includes("spreadsheetml"), "content-type XLSX benar", xls.headers.get("content-type") ?? "—");
  ok(!!xls.buf && xls.buf.length > 1000, "buffer > 1000 byte", `${xls.buf?.length} byte`);
  ok(xls.buf?.slice(0, 2).toString() === "PK", "magic bytes PK (zip/xlsx)");
  {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xls.buf as never);
    const ws = wb.worksheets[0];
    ok(ws?.name === "Struktur Jabatan", "nama sheet", ws?.name ?? "—");
    ok(ws?.getCell(1, 1).value === "Laporan Struktur Jabatan", "judul laporan (baris 1)", String(ws?.getCell(1, 1).value));
    const headers = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => String(ws?.getRow(2).getCell(c).value ?? ""));
    ok(headers[0] === "Family" && headers[1] === "Kode Family" && headers[2] === "Kode Job", "header ID lengkap (Family/Kode Family/Kode Job)", headers.join(" | "));
    ok(headers[6] === "Posisi Terisi" && headers[7] === "Mission", "header jumlah posisi/terisi/mission", headers.join(" | "));
    const allCells = ws?.getSheetValues() ?? [];
    const flat = JSON.stringify(allCells);
    ok(flat.includes("J-HRM"), "baris job seeded J-HRM ada di laporan");
    ok(flat.includes("JF-STAFF"), "kode family seeded tampil");
  }
  const xlsEn = await hr.api("GET", `${FAM_API}?export=xlsx&lang=en`, undefined, true);
  ok(xlsEn.status === 200 && (xlsEn.buf?.length ?? 0) > 1000, "export lang=en → 200 + >1000 byte", `${xlsEn.buf?.length} byte`);
  {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsEn.buf as never);
    const ws = wb.worksheets[0];
    ok(ws?.name === "Job Structure", "nama sheet EN via BASE_EN", ws?.name ?? "—");
    ok(String(ws?.getCell(1, 1).value) === "Job Structure Report", "judul EN via BASE_EN");
    const headersEn = [1, 2, 3, 6, 7].map((c) => String(ws?.getRow(2).getCell(c).value ?? ""));
    ok(headersEn[1] === "Family Code" && headersEn[2] === "Job Code" && headersEn[3] === "Number of Positions" && headersEn[4] === "Positions Filled", "header EN via BASE_EN", headersEn.join(" | "));
  }
  const logExport = await db.activityLog.findFirst({
    where: { entity: "JobFamily", action: "Exported", createdAt: { gte: startedAt } },
  });
  ok(!!logExport, "ActivityLog Exported (laporan struktur jabatan) tertulis");

  // ================= (9) MENU GUARD (ESS) =================
  console.log("\n[(9)] MENU GUARD — ESS ditolak (hr:jobs)");
  const loginEss = await ess.api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(loginEss.status === 200, `login ESS ${ESS_EMAIL}`, `HTTP ${loginEss.status}`);
  const gEssList = await ess.api("GET", FAM_API);
  ok(gEssList.status === 403, "ESS GET job-families → 403 (menu-guard)", `HTTP ${gEssList.status}`);
  const gEssPost = await ess.api("POST", FAM_API, { code: "JF-HACK", name: "Hack" });
  ok(gEssPost.status === 403, "ESS POST job-families → 403", `HTTP ${gEssPost.status}`);

  // ================= (10) CLEANUP =================
  console.log("\n[(10)] CLEANUP — hapus job uji + family uji (ActivityLog DIPERTAHANKAN)");
  const dJob = await hr.api("DELETE", `${JOB_API}?id=${encodeURIComponent(jobId)}`);
  ok(dJob.status === 200, "hapus job uji → 200", `HTTP ${dJob.status}`);
  const dChild = await hr.api("DELETE", `${FAM_API}?id=${encodeURIComponent(childId)}`);
  ok(dChild.status === 200, "hapus sub-family (job sudah dilepas) → 200", `HTTP ${dChild.status}`);
  const dRoot = await hr.api("DELETE", `${FAM_API}?id=${encodeURIComponent(rootId)}`);
  ok(dRoot.status === 200, "hapus root (sub-family sudah hilang) → 200", `HTTP ${dRoot.status}`);
  const dOther = await hr.api("DELETE", `${FAM_API}?id=${encodeURIComponent(otherRootId)}`);
  ok(dOther.status === 200, "hapus root uji pindah → 200", `HTTP ${dOther.status}`);

  const famLeft = await db.jobFamily.count({ where: { OR: [{ code: { startsWith: "JF-E2E31-" } }, { name: { startsWith: "E2e31" } }] } });
  ok(famLeft === 0, "family uji bersih");
  const jobLeft = await db.job.count({ where: { code: { startsWith: "E2E31-" } } });
  ok(jobLeft === 0, "job uji bersih");
  const famCountAfter = await db.jobFamily.count();
  const jobCountAfter = await db.job.count();
  ok(famCountAfter === famCountBefore, `jumlah family kembali ke pra-uji`, `${famCountAfter} vs ${famCountBefore}`);
  ok(jobCountAfter === jobCountBefore, `jumlah job kembali ke pra-uji`, `${jobCountAfter} vs ${jobCountBefore}`);
  const logsKept = await db.activityLog.count({
    where: { entity: { in: ["JobFamily", "Job"] }, createdAt: { gte: startedAt } },
  });
  ok(logsKept >= 10, "ActivityLog uji DIPERTAHANKAN (audit trail)", `${logsKept} baris`);

  console.log(`\nE2E P3.1: ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
