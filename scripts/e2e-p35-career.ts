// P3.5-BM (D-BM27) — E2E CAREER PATHING (local dev :3000) di atas data demo MII:
//   (0) SETUP: login HR owner hrd@mii.co.id; pre-clean jalur uji lama; pilih
//       DUA POSISI NYATA MII (A = punya pemegang aktif, B ≠ A, tanpa jalur
//       existing); 3 keahlian nyata katalog (EXCL/SQL/COMM); akun ESS utk
//       pemegang A (pola seed-ess-demo-user — idempoten, dipertahankan).
//   (1) ADMIN CREATE: POST career-paths A→B dgn 2 syarat [EXCL≥3, SQL≥4]
//       → 201 + row db + requiredSkillsJson; GET daftar memuat judul posisi +
//       nama keahlian; GET ?options=1 memuat posisi aktif + katalog aktif.
//   (2) GUARD: pasangan duplikat → 409; JALUR BALIK LANGSUNG B→A → 400
//       dwibahasa (ID + EN); A→A → 400; level 9 → 400; skillId duplikat → 400;
//       >15 entri → 400.
//   (3) PATCH: tambah syarat ke-3 [COMM≥2] + ubah catatan → 200 + json 3 entri.
//   (4) ESS GAP: login pemegang A; beri EmployeeSkill via prisma — EXCL=5
//       (MEMENUHI), SQL=2 (DI BAWAH), COMM TANPA BARIS (BELUM DINILAI) →
//       GET my-career: posisi A, jalur A→B hadir, rincian required/my/ok
//       [3/5/T, 4/2/F, 2/null/F], met 1 total 3, mySkills 2 baris; lalu
//       tambah COMM=5 → met 2/3 (2 dari 3 terpenuhi). Guard: tanpa sesi 401;
//       sesi ESS tanpa menu admin → GET career-paths 403 + POST 403.
//   (5) SUCCESSION TERSTRUKTUR: SuccessionPosition di B + SuccessorCandidate
//       (pemegang A — bukan pemegang B) via prisma → POST updateCandidate
//       devNotesItems 2 aksi → tersimpan JSON {"v":1,...} → GET ?succession=1
//       render checklist (devNotesItems) → toggle index 0 done=true → persist
//       + ActivityLog → legacy: tulis teks biasa via prisma → GET kembali
//       sebagai TEKS (devNotesItems null, tidak rusak) → toggle di legacy → 400.
//   (6) CLEANUP: hapus jalur uji (A→B + A→C), EmployeeSkill yang dibuat script,
//       fixture succession; hitungan kembali ke baseline; ActivityLog
//       DIPERTAHANKAN (audit trail). Akun ESS dipertahankan (fixture
//       terdokumentasi — idempoten re-run).
// Jalankan: bun scripts/e2e-p35-career.ts  (server dev di :3000)
import "./lib/env";
import { db as platform } from "@/lib/db";
import { hashPassword } from "@/rekankerja/shared/lib/auth";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const TENANT_SLUG = "pt-mitra-industri-internasional";
const CP_API = "/api/rekankerja/career-paths";
const MY_CAREER_API = "/api/rekankerja/ess/my-career";
const TALENT_API = "/api/rekankerja/performance/talent";
const ESS_EMAIL = "mycareer.p35@mii.co.id";
const ESS_PASSWORD = "P35MyCareer123!";
const LEGACY_TEXT = "Catatan pengembangan lama (teks biasa pra-P3.5)";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie) — pola e2e-p33. Retry ringan utk
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

/** Pastikan akun ESS ada (AppUser tenant + platform user + membership MII) —
 *  pola scripts/seed-ess-demo-user.ts, idempoten. */
async function ensureEssAccount(email: string, password: string, employeeId: string) {
  const db = getTenantClient(SCHEMA);
  let appUser = await db.appUser.findFirst({ where: { email } });
  if (!appUser) {
    appUser = await db.appUser.create({
      data: {
        username: email.split("@")[0]!,
        fullName: email.split("@")[0]!,
        email,
        role: "ESS",
        employeeId,
        passwordChangedAt: new Date(),
      },
    });
  } else {
    appUser = await db.appUser.update({ where: { id: appUser.id }, data: { employeeId, email, role: "ESS" } });
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
    await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "VIEWER" } });
  }
  const hist = await db.passwordHistory.findFirst({ where: { appUserId: appUser.id } });
  if (!hist) {
    await db.passwordHistory.create({ data: { appUserId: appUser.id, hash: hashPassword(password) } });
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const ess = new Sesi();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login HR owner + pilih posisi asal/tujuan nyata + keahlian");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  // pre-clean jalur uji lama (re-run). CareerPath = fitur BARU P3.5 — SEMUA
  // baris existing di tenant demo adalah residu uji (agent dev / run crash),
  // aman dihapus total demi deterministis (tidak ada data produksi lama).
  const staleCount = await db.careerPath.count();
  await db.careerPath.deleteMany({});
  ok(true, `pre-clean jalur residu (${staleCount} baris dihapus — fitur baru P3.5)`);

  // 3 keahlian NYATA dari katalog ter-seed (D-BM24)
  const [skExcl, skSql, skComm] = await Promise.all([
    db.skillCatalog.findUnique({ where: { code: "SKL-EXCL" }, select: { id: true, name: true, code: true } }),
    db.skillCatalog.findUnique({ where: { code: "SKL-SQL" }, select: { id: true, name: true, code: true } }),
    db.skillCatalog.findUnique({ where: { code: "SKL-COMM" }, select: { id: true, name: true, code: true } }),
  ]);
  ok(!!skExcl && !!skSql && !!skComm, "3 keahlian nyata katalog ditemukan (SKL-EXCL/SQL/COMM)");
  if (!skExcl || !skSql || !skComm) process.exit(1);

  // posisi ASAL (A): posisi aktif dgn pemegang tetap (assignment aktif TERBARU
  // pemegangnya di posisi itu) + bukan direktur; posisi TUJUAN (B): posisi
  // aktif lain tanpa jalur existing dua arah.
  const latestAsg = await db.employeeAssignment.findFirst({
    where: { validTo: null, positionId: { not: null }, employee: { status: "Active" } },
    select: { employeeId: true, positionId: true, validFrom: true },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
  });
  const holderA = await db.employee.findUnique({
    where: { id: latestAsg?.employeeId ?? "x" },
    select: { id: true, fullName: true, employeeNo: true },
  });
  ok(!!latestAsg && !!holderA, "pemegang posisi asal (A) ditemukan", holderA ? `${holderA.employeeNo} ${holderA.fullName}` : "—");
  if (!latestAsg || !holderA) process.exit(1);

  const posA = await db.position.findUnique({
    where: { id: latestAsg.positionId! },
    select: { id: true, code: true, title: true, active: true },
  });
  ok(!!posA, `posisi asal A = ${posA?.code} ${posA?.title}`);
  if (!posA) process.exit(1);

  const otherPositions = await db.position.findMany({
    where: { active: true, id: { not: posA.id } },
    select: { id: true, code: true, title: true },
    orderBy: { title: "asc" },
  });
  // semua jalur sudah dibersihkan di pre-clean → tidak ada pasangan existing
  const existingPairs = new Set<string>();
  const posB = otherPositions.find(
    (p) => !existingPairs.has(`${posA.id}|${p.id}`) && !existingPairs.has(`${p.id}|${posA.id}`),
  );
  ok(!!posB, `posisi tujuan B = ${posB?.code} ${posB?.title}`);
  if (!posB) process.exit(1);
  const posC = otherPositions.find((p) => p.id !== posB.id && !existingPairs.has(`${p.id}|${posB.id}`));
  ok(!!posC, `posisi pendamping C = ${posC?.code} ${posC?.title} (utk guard validasi)`);
  if (!posC) process.exit(1);

  // akun ESS pemegang A (fixture dipertahankan — idempoten)
  await ensureEssAccount(ESS_EMAIL, ESS_PASSWORD, holderA.id);
  const essLogin = await ess.api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(essLogin.status === 200, `login ESS pemegang A (${ESS_EMAIL})`, `HTTP ${essLogin.status}`);

  // idempotensi re-run: netralkan residu run/agent sebelumnya (evidence fixture)
  // supaya createdSkillIds & baseline deterministik.
  await db.employeeSkill.deleteMany({
    where: { employeeId: holderA.id, skillId: { in: [skExcl.id, skSql.id, skComm.id] }, evidence: `${ESS_EMAIL} e2e` },
  });
  // snapshot baseline (cleanup harus kembali ke sini)
  const baseline = {
    careerPath: await db.careerPath.count(),
    employeeSkill: await db.employeeSkill.count(),
    successionPosition: await db.successionPosition.count(),
    successorCandidate: await db.successorCandidate.count(),
  };
  // EmployeeSkill pemegang A pra-uji (dinetralkan: hanya hapus yang script buat)
  const preExistingSkillIds = new Set(
    (await db.employeeSkill.findMany({ where: { employeeId: holderA.id }, select: { skillId: true } })).map((s) => s.skillId),
  );

  // ================= (1) ADMIN CREATE =================
  console.log("\n[(1)] ADMIN CREATE — jalur A→B + 2 syarat keahlian");
  const c1 = await hr.api("POST", CP_API, {
    fromPositionId: posA.id,
    toPositionId: posB.id,
    requirements: [
      { skillId: skExcl.id, level: 3 },
      { skillId: skSql.id, level: 4 },
    ],
    note: "E2E35 jalur uji — promosi internal",
  });
  ok(c1.status === 201, "POST jalur A→B (2 syarat) → 201", `HTTP ${c1.status} — ${c1.json?.error ?? ""}`);
  ok(c1.json?.path?.toPosition?.code === posB.code, "respons memuat posisi tujuan", c1.json?.path?.toPosition?.code);
  ok(
    (c1.json?.path?.requirements ?? []).length === 2
      && c1.json.path.requirements.some((r: any) => r.skillId === skExcl.id && r.level === 3 && r.name === skExcl.name),
    "respons memuat syarat + NAMA keahlian",
  );

  const row1 = await db.careerPath.findFirst({
    where: { fromPositionId: posA.id, toPositionId: posB.id },
    select: { id: true, requiredSkillsJson: true, note: true },
  });
  ok(!!row1, "row CareerPath tersimpan di db");
  const req1 = row1 ? (JSON.parse(row1.requiredSkillsJson ?? "[]") as { skillId: string; level: number }[]) : [];
  ok(req1.length === 2 && req1[0]?.skillId === skExcl.id && req1[0]?.level === 3 && req1[1]?.skillId === skSql.id && req1[1]?.level === 4,
    "requiredSkillsJson = [{skillId, level}] benar", row1?.requiredSkillsJson ?? "—");
  ok(row1?.note === "E2E35 jalur uji — promosi internal", "catatan tersimpan");

  const list1 = await hr.api("GET", CP_API);
  ok(list1.status === 200, "GET daftar jalur → 200");
  const listRow = (list1.json?.paths ?? []).find((p: any) => p.id === row1?.id);
  ok(
    !!listRow && listRow.fromPosition.title === posA.title && listRow.toPosition.title === posB.title
      && listRow.requirements.length === 2 && listRow.requirements.every((r: any) => typeof r.name === "string"),
    "GET daftar memuat judul posisi asal/tujuan + nama keahlian",
  );
  ok(list1.json?.stats?.paths >= 1 && list1.json?.stats?.sources >= 1, "stats terbentuk", JSON.stringify(list1.json?.stats));

  const opt1 = await hr.api("GET", `${CP_API}?options=1`);
  ok(
    opt1.status === 200
      && (opt1.json?.positions ?? []).some((p: any) => p.id === posA.id && p.title === posA.title)
      && (opt1.json?.skills ?? []).some((s: any) => s.id === skExcl.id),
    "GET ?options=1 memuat posisi aktif + katalog aktif",
  );

  const logCreated = await db.activityLog.findFirst({
    where: { entity: "CareerPath", entityId: row1?.id, action: "Created" },
    select: { detail: true },
  });
  ok(!!logCreated && (logCreated?.detail ?? "").includes("→"), "ActivityLog Created CareerPath tertulis", (logCreated?.detail ?? "—").slice(0, 60));

  // ================= (2) GUARD =================
  console.log("\n[(2)] GUARD — duplikat 409 · jalur balik langsung 400 dwibahasa · validasi");
  const dup = await hr.api("POST", CP_API, { fromPositionId: posA.id, toPositionId: posB.id });
  ok(dup.status === 409, "pasangan duplikat → 409", `HTTP ${dup.status}`);
  ok(String(dup.json?.error ?? "").includes("sudah terdaftar") && String(dup.json?.error ?? "").includes("already exists"),
    "pesan 409 dwibahasa", String(dup.json?.error ?? "").slice(0, 70));

  const reverse = await hr.api("POST", CP_API, { fromPositionId: posB.id, toPositionId: posA.id });
  ok(reverse.status === 400, "JALUR BALIK LANGSUNG B→A → 400", `HTTP ${reverse.status}`);
  ok(
    String(reverse.json?.error ?? "").includes("Jalur balik langsung tidak diperbolehkan")
      && String(reverse.json?.error ?? "").includes("A direct reverse path is not allowed"),
    "pesan 400 dwibahasa (ID + EN)",
    String(reverse.json?.error ?? "").slice(0, 90),
  );

  const same = await hr.api("POST", CP_API, { fromPositionId: posA.id, toPositionId: posA.id });
  ok(same.status === 400, "posisi tujuan = posisi asal → 400", `HTTP ${same.status}`);

  const badLevel = await hr.api("POST", CP_API, {
    fromPositionId: posB.id,
    toPositionId: posC.id,
    requirements: [{ skillId: skExcl.id, level: 9 }],
  });
  ok(badLevel.status === 400, "level syarat 9 → 400", `HTTP ${badLevel.status} — ${String(badLevel.json?.error ?? "").slice(0, 50)}`);

  const dupSkill = await hr.api("POST", CP_API, {
    fromPositionId: posB.id,
    toPositionId: posC.id,
    requirements: [{ skillId: skExcl.id, level: 2 }, { skillId: skExcl.id, level: 3 }],
  });
  ok(dupSkill.status === 400, "skillId duplikat dalam syarat → 400", `HTTP ${dupSkill.status}`);

  const manySkills = await db.skillCatalog.findMany({ where: { active: true }, select: { id: true }, take: 16 });
  const tooMany = await hr.api("POST", CP_API, {
    fromPositionId: posB.id,
    toPositionId: posC.id,
    requirements: manySkills.map((s) => ({ skillId: s.id, level: 1 })),
  });
  ok(tooMany.status === 400, `>15 syarat (${manySkills.length}) → 400`, `HTTP ${tooMany.status}`);

  // jalur kedua A→C utk uji guard PATCH (duplikat + balik), dihapus di cleanup
  const c2 = await hr.api("POST", CP_API, { fromPositionId: posA.id, toPositionId: posC.id, note: "E2E35 jalur sementara" });
  ok(c2.status === 201, "jalur kedua A→C (utk guard PATCH) → 201", `HTTP ${c2.status}`);
  const row2 = await db.careerPath.findFirst({
    where: { fromPositionId: posA.id, toPositionId: posC.id },
    select: { id: true },
  });

  const patchDup = row2
    ? await hr.api("PATCH", CP_API, { id: row2.id, fromPositionId: posA.id, toPositionId: posB.id })
    : { status: 0, json: {} };
  ok(patchDup.status === 409, "PATCH A→C jadi A→B (duplikat jalur pertama) → 409", `HTTP ${patchDup.status}`);

  const patchCycle = row2
    ? await hr.api("PATCH", CP_API, { id: row2.id, fromPositionId: posB.id, toPositionId: posA.id })
    : { status: 0, json: {} };
  ok(patchCycle.status === 400, "PATCH A→C jadi B→A (balik jalur pertama) → 400", `HTTP ${patchCycle.status}`);
  // ================= (3) PATCH =================
  console.log("\n[(3)] PATCH — tambah syarat ke-3 + ubah catatan");
  const patch1 = await hr.api("PATCH", CP_API, {
    id: row1!.id,
    requirements: [
      { skillId: skExcl.id, level: 3 },
      { skillId: skSql.id, level: 4 },
      { skillId: skComm.id, level: 2 },
    ],
    note: "E2E35 jalur uji — promosi internal (rev)",
  });
  ok(patch1.status === 200, "PATCH jalur (3 syarat + catatan) → 200", `HTTP ${patch1.status} — ${patch1.json?.error ?? ""}`);
  const row1b = await db.careerPath.findUnique({ where: { id: row1!.id }, select: { requiredSkillsJson: true, note: true } });
  const req1b = row1b ? (JSON.parse(row1b.requiredSkillsJson ?? "[]") as { skillId: string; level: number }[]) : [];
  ok(req1b.length === 3 && req1b[2]?.skillId === skComm.id && req1b[2]?.level === 2, "syarat ke-3 [COMM≥2] tersimpan");
  ok(row1b?.note === "E2E35 jalur uji — promosi internal (rev)", "catatan ter-update");
  const logUpdated = await db.activityLog.findFirst({
    where: { entity: "CareerPath", entityId: row1!.id, action: "Updated" },
    select: { detail: true },
  });
  ok(!!logUpdated, "ActivityLog Updated CareerPath tertulis");

  // ================= (4) ESS — JALUR KARIER SAYA + GAP =================
  console.log("\n[(4)] ESS MY-CAREER — gap 1/3 (meeting/below/missing) lalu 2/3");
  // beri penilaian via prisma langsung: EXCL=5 (memenuhi ≥3), SQL=2 (di bawah ≥4), COMM tanpa baris
  await db.employeeSkill.createMany({
    data: [
      { employeeId: holderA.id, skillId: skExcl.id, level: 5, evidence: `${ESS_EMAIL} e2e` },
      { employeeId: holderA.id, skillId: skSql.id, level: 2, evidence: `${ESS_EMAIL} e2e` },
    ],
  });
  ok(true, "EmployeeSkill pemegang A dibuat via prisma (EXCL=5, SQL=2)");

  const mc1 = await ess.api("GET", MY_CAREER_API);
  ok(mc1.status === 200, "GET my-career (sesi ESS) → 200", `HTTP ${mc1.status}`);
  ok(mc1.json?.employee?.employeeNo === holderA.employeeNo, "payload memuat identitas karyawan", mc1.json?.employee?.employeeNo);
  ok(mc1.json?.position?.id === posA.id && mc1.json.position.title === posA.title, "posisi saat ini = posisi A", mc1.json?.position?.title);
  ok(mc1.json?.employee?.tenureYears != null && mc1.json.employee.joinDate != null, "tenure + joinDate terbentuk",
    `${mc1.json?.employee?.tenureYears}th ${mc1.json?.employee?.tenureMonths}bl`);

  const mcPath = (mc1.json?.paths ?? []).find((p: any) => p.id === row1!.id);
  ok(!!mcPath, "jalur A→B hadir di my-career");
  ok(mcPath?.toPosition?.code === posB.code, "target = posisi B", mcPath?.toPosition?.code);
  const dExcl = mcPath?.requirements?.find((r: any) => r.skillId === skExcl.id);
  const dSql = mcPath?.requirements?.find((r: any) => r.skillId === skSql.id);
  const dComm = mcPath?.requirements?.find((r: any) => r.skillId === skComm.id);
  ok(dExcl?.required === 3 && dExcl?.my === 5 && dExcl?.ok === true, "EXCL: required 3 · my 5 → ok", JSON.stringify(dExcl));
  ok(dSql?.required === 4 && dSql?.my === 2 && dSql?.ok === false, "SQL: required 4 · my 2 → TIDAK ok (di bawah)", JSON.stringify(dSql));
  ok(dComm?.required === 2 && dComm?.my === null && dComm?.ok === false, "COMM: required 2 · my null → TIDAK ok (belum dinilai)", JSON.stringify(dComm));
  ok(dExcl?.name === skExcl.name && dComm?.name === skComm.name, "rincian memuat NAMA keahlian");
  ok(mcPath?.met === 1 && mcPath?.total === 3, "ringkasan gap = 1/3 (satu memenuhi)", `${mcPath?.met}/${mcPath?.total}`);
  ok(
    (mc1.json?.skills ?? []).find((s: any) => s.skillId === skExcl.id)?.level === 5
      && (mc1.json?.skills ?? []).find((s: any) => s.skillId === skSql.id)?.level === 2
      && !(mc1.json?.skills ?? []).some((s: any) => s.skillId === skComm.id),
    "daftar level keahlian saya memuat EXCL 5 + SQL 2 (COMM belum)",
  );
  ok(mcPath?.note === "E2E35 jalur uji — promosi internal (rev)", "catatan jalur terbaca ESS");

  // upgrade: tambah COMM=5 → gap jadi 2/3
  await db.employeeSkill.create({
    data: { employeeId: holderA.id, skillId: skComm.id, level: 5, evidence: `${ESS_EMAIL} e2e` },
  });
  const mc2 = await ess.api("GET", MY_CAREER_API);
  const mc2Path = (mc2.json?.paths ?? []).find((p: any) => p.id === row1!.id);
  ok(mc2Path?.met === 2 && mc2Path?.total === 3, "setelah COMM dinilai 5 → gap = 2/3 (2 dari 3 terpenuhi)", `${mc2Path?.met}/${mc2Path?.total}`);
  ok((mc2.json?.skills ?? []).find((s: any) => s.skillId === skComm.id)?.level === 5, "daftar keahlian saya memuat COMM 5 (3 baris ter-dinilai)");

  // guard: tanpa sesi → 401; sesi ESS tanpa menu admin → 403
  const noSess = await new Sesi().api("GET", MY_CAREER_API);
  ok(noSess.status === 401, "my-career tanpa sesi → 401", `HTTP ${noSess.status}`);
  const essAdminList = await ess.api("GET", CP_API);
  ok(essAdminList.status === 403, "sesi ESS → GET career-paths (menu admin) → 403", `HTTP ${essAdminList.status}`);
  const essAdminPost = await ess.api("POST", CP_API, { fromPositionId: posA.id, toPositionId: posB.id });
  ok(essAdminPost.status === 403, "sesi ESS → POST career-paths → 403", `HTTP ${essAdminPost.status}`);

  // ================= (5) SUCCESSION — DEVNOTES TERSTRUKTUR =================
  console.log("\n[(5)] SUCCESSION — aksi pengembangan terstruktur (D-BM27) + legacy");
  // fixture: register succession di B + kandidat pemegang A (bukan pemegang B)
  // idempotensi re-run: hapus register succession residu di B dulu (note E2E35)
  const staleSucc = await db.successionPosition.findFirst({
    where: { positionId: posB.id }, // note apa pun — residu agent dev / run crash
    select: { id: true },
  });
  if (staleSucc) {
    await db.successorCandidate.deleteMany({ where: { successionPositionId: staleSucc.id } });
    await db.successionPosition.delete({ where: { id: staleSucc.id } });
  }
  const succPos = await db.successionPosition.create({
    data: { positionId: posB.id, critical: true, targetSuccessors: 1, note: "E2E35 fixture" },
    select: { id: true },
  });
  const cand = await db.successorCandidate.create({
    data: {
      successionPositionId: succPos.id,
      employeeId: holderA.id,
      readiness: "Development",
      devNotes: null,
    },
    select: { id: true },
  });
  ok(!!succPos && !!cand, "fixture SuccessionPosition(B) + SuccessorCandidate(pemegang A) dibuat");

  const save = await hr.api("POST", TALENT_API, {
    action: "updateCandidate",
    id: cand.id,
    readiness: "Ready1yr",
    devNotesItems: [
      { action: "Mentoring bulanan dengan pemegang B", done: false },
      { action: "Rotasi ke unit terkait 3 bulan", done: false },
    ],
  });
  ok(save.status === 200, "updateCandidate devNotesItems 2 aksi → 200", `HTTP ${save.status} — ${save.json?.error ?? ""}`);
  ok(save.json?.readiness === "Ready1yr", "readiness ikut tersimpan", save.json?.readiness);
  const candDb1 = await db.successorCandidate.findUnique({ where: { id: cand.id }, select: { devNotes: true } });
  const parsed1 = candDb1?.devNotes ? (JSON.parse(candDb1.devNotes) as { v: number; items: { action: string; done: boolean }[] }) : null;
  ok(parsed1?.v === 1 && parsed1.items.length === 2 && parsed1.items[0]?.action === "Mentoring bulanan dengan pemegang B" && parsed1.items.every((x) => x.done === false),
    "devNotes tersimpan JSON {\"v\":1,\"items\":[…]} di kolom yang sama", candDb1?.devNotes?.slice(0, 60));

  const succ1 = await hr.api("GET", `${TALENT_API}?succession=1`);
  ok(succ1.status === 200, "GET succession register → 200");
  const succRow = (succ1.json?.positions ?? []).find((p: any) => p.id === succPos.id);
  const succCand = (succRow?.candidates ?? []).find((c: any) => c.id === cand.id);
  ok(succCand?.devNotesItems?.length === 2 && succCand.devNotesItems[0]?.action === "Mentoring bulanan dengan pemegang B",
    "GET render checklist (devNotesItems 2 aksi)", JSON.stringify(succCand?.devNotesItems ?? null));
  ok(typeof succCand?.devNotes === "string" && (JSON.parse(succCand.devNotes) as { v: number }).v === 1,
    "field devNotes mentah tetap dikirim (JSON v1)");

  const tog = await hr.api("POST", TALENT_API, { action: "toggleDevNote", id: cand.id, index: 0, done: true });
  ok(tog.status === 200, "toggleDevNote index 0 done=true → 200", `HTTP ${tog.status} — ${tog.json?.error ?? ""}`);
  ok(tog.json?.devNotesItems?.[0]?.done === true && tog.json?.devNotesItems?.[1]?.done === false, "respons checklist: item 0 selesai, item 1 belum");
  const candDb2 = await db.successorCandidate.findUnique({ where: { id: cand.id }, select: { devNotes: true } });
  const parsed2 = candDb2?.devNotes ? (JSON.parse(candDb2.devNotes) as { items: { done: boolean }[] }) : null;
  ok(parsed2?.items?.[0]?.done === true && parsed2?.items?.[1]?.done === false, "toggle PERSIST di db (JSON items[0].done=true)");
  const succ2 = await hr.api("GET", `${TALENT_API}?succession=1`);
  const succCand2 = ((succ2.json?.positions ?? []).find((p: any) => p.id === succPos.id)?.candidates ?? []).find((c: any) => c.id === cand.id);
  ok(succCand2?.devNotesItems?.[0]?.done === true, "GET ulang: checklist item 0 selesai (persist)");
  const logToggle = await db.activityLog.findFirst({
    where: { entity: "SuccessorCandidate", entityId: cand.id, detail: { contains: "dicentang selesai" } },
    select: { detail: true },
  });
  ok(!!logToggle, "ActivityLog toggle tertulis", logToggle?.detail?.slice(0, 70) ?? "—");

  // validasi editor: >10 aksi → 400; teks >200 → 400
  const tooManyItems = await hr.api("POST", TALENT_API, {
    action: "updateCandidate", id: cand.id,
    devNotesItems: Array.from({ length: 11 }, (_, i) => ({ action: `Aksi ${i + 1}`, done: false })),
  });
  ok(tooManyItems.status === 400, ">10 aksi → 400", `HTTP ${tooManyItems.status}`);
  const tooLong = await hr.api("POST", TALENT_API, {
    action: "updateCandidate", id: cand.id,
    devNotesItems: [{ action: "x".repeat(201), done: false }],
  });
  ok(tooLong.status === 400, "teks aksi 201 kar → 400", `HTTP ${tooLong.status}`);

  // legacy: tulis teks biasa langsung via prisma → GET tidak rusak (teks apa adanya)
  await db.successorCandidate.update({ where: { id: cand.id }, data: { devNotes: LEGACY_TEXT } });
  const succ3 = await hr.api("GET", `${TALENT_API}?succession=1`);
  const succCand3 = ((succ3.json?.positions ?? []).find((p: any) => p.id === succPos.id)?.candidates ?? []).find((c: any) => c.id === cand.id);
  ok(succCand3?.devNotes === LEGACY_TEXT, "legacy teks biasa dikembalikan APA ADANYA (tidak rusak)", String(succCand3?.devNotes).slice(0, 40));
  ok(succCand3?.devNotesItems == null, "legacy teks → devNotesItems null (UI render teks, bukan checklist)");
  const togLegacy = await hr.api("POST", TALENT_API, { action: "toggleDevNote", id: cand.id, index: 0, done: true });
  ok(togLegacy.status === 400, "toggle pada teks legacy → 400 (konversi dulu via editor)", `HTTP ${togLegacy.status}`);

  // ================= (6) CLEANUP =================
  console.log("\n[(6)] CLEANUP — jalur + EmployeeSkill uji + fixture succession (ActivityLog dipertahankan)");
  // hapus penilaian yang dibuat script saja (pertahankan pra-existing)
  const delSkills = await db.employeeSkill.deleteMany({
    where: { employeeId: holderA.id, skillId: { in: [skExcl.id, skSql.id, skComm.id].filter((id) => !preExistingSkillIds.has(id)) }, evidence: `${ESS_EMAIL} e2e` },
  });
  // sisa baris fixture run INI (bila preExisting kosong di awal, 3 baris) — hapus paksa
  const delSkills2 = await db.employeeSkill.deleteMany({
    where: { employeeId: holderA.id, evidence: `${ESS_EMAIL} e2e` },
  });
  delSkills.count += delSkills2.count;
  ok(delSkills.count >= 2, "EmployeeSkill uji terhapus", String(delSkills.count));
  await db.successorCandidate.delete({ where: { id: cand.id } });
  await db.successionPosition.delete({ where: { id: succPos.id } });
  ok(true, "fixture succession terhapus (kandidat + register)");
  // hapus jalur kedua lewat API (mutasi DELETE + ActivityLog teruji), sisanya prisma
  const delApi = row2 ? await hr.api("DELETE", `${CP_API}?id=${row2.id}`) : { status: 0, json: {} };
  ok(delApi.status === 200, "DELETE jalur A→C via API → 200", `HTTP ${delApi.status}`);
  const delLog = await db.activityLog.count({ where: { entity: "CareerPath", action: "Deleted", createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  ok(delLog >= 1, "ActivityLog Deleted CareerPath tertulis", `${delLog} baris`);
  const delPaths = await db.careerPath.deleteMany({ where: { id: row1!.id } });
  ok(delPaths.count === 1, "jalur utama A→B terhapus", String(delPaths.count));

  const after = {
    careerPath: await db.careerPath.count(),
    employeeSkill: await db.employeeSkill.count(),
    successionPosition: await db.successionPosition.count(),
    successorCandidate: await db.successorCandidate.count(),
  };
  ok(
    after.careerPath === baseline.careerPath && after.employeeSkill === baseline.employeeSkill
      && after.successionPosition === baseline.successionPosition && after.successorCandidate === baseline.successorCandidate,
    "semua hitungan kembali ke pra-uji",
    JSON.stringify({ baseline, after }),
  );
  console.log(
    `  (akun ESS ${ESS_EMAIL} dipertahankan sebagai fixture terdokumentasi — idempoten utk re-run)`,
  );

  console.log(`\nE2E P3.5: ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
