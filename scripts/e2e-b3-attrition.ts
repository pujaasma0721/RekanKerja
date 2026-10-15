// Uji E2E API B3 (Heuristik Attrisi Explainable — Talent) per
// DEVELOPMENT-PLAN-BACKLOG.md §4 B3 / D-BL10…D-BL12 — di atas data demo MII
// (login owner hrd@mii.co.id; ESS yusuf@mii.co.id):
//   (a) STRUKTUR: GET talent 200 → rows semua karyawan Active; tiap baris
//       ber-factors 6 key (rating|trend|pip|tenure|compa|reward) dgn skor
//       0–100 + level Tinggi/Sedang/Rendah; stats Σ = total.
//   (b) DETERMINISTIK: Tuti Gunawan MII00013 (rating historis 2 via db) —
//       skor EKSPEKTASI dihitung MANUAL di skrip ini dari db yang sama
//       (rating, pip, tenure, compa via decryptMoney, reward) lalu
//       dibandingkan dgn skor API (toleransi ±1).
//   (c) NETRALISASI (D-BL11): Joko MII00005 tanpa appraisal → faktor rating &
//       trend available=false DAN tidak ikut penyebut (Σmax tersedia < 100);
//       Siti MII00050 tanpa grade → faktor compa unavailable.
//   (d) AKSES (D-BL12): ESS yusuf (diverifikasi via db managerId bukan
//       atasan siapa pun) GET talent → 403; service level: atasan langsung
//       (Joko, 19 bawahan) hanya melihat tim; Direksi (Hartono, CEO) semua;
//       karyawan biasa (Tuti) → TalentForbiddenError 403.
//   (e) onlyHigh=1: injeksi sementara PIP Active utk Budi MII00035 (47→
//       skor naik melewati 50) → semua baris level Tinggi + Budi ada;
//       PIP uji dibersihkan (stateless — tanpa jejak).
// Jalankan: bun scripts/e2e-b3-attrition.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  listAttritionRisk, TalentForbiddenError,
} from "@/rekankerja/performance/services/talent-service";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
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
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
}

// ============ hitungan EKSPEKTASI manual (duplikasi aturan D-BL10 — sengaja
// tidak mengimpor helper service supaya regression tertangkap) ============
const MONTHS_MS = 30.4375 * 86_400_000;
const YEARS_MS = 365.25 * 86_400_000;

function expTenureScore(years: number): number {
  if (years < 1) return 5;
  if (years < 2) return 8;
  if (years <= 5) return 5;
  return 0;
}
function expCompaScore(ratio: number): number {
  if (ratio < 0.80) return 15;
  if (ratio < 0.95) return 8;
  return 0;
}
function expRewardScore(months: number, lastRating: number | null): number {
  if (months <= 24) return 0;
  return lastRating != null && lastRating >= 4 ? 15 : 8;
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const yusuf = new Sesi();

  console.log("\n[(a)] STRUKTUR — GET talent (owner = HR penuh)");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const list = await owner.api("GET", "/api/rekankerja/performance/talent");
  ok(list.status === 200 && Array.isArray(list.json.rows) && list.json.rows.length >= 20,
    "GET talent → 200 + rows semua karyawan Active", `HTTP ${list.status}, rows=${list.json.rows?.length}`);
  const rows0 = (list.json.rows ?? []) as Record<string, any>[];
  const stats0 = list.json.stats ?? {};
  ok(stats0.tinggi + stats0.sedang + stats0.rendah === stats0.total && stats0.total >= 20,
    "stats Σ tinggi+sedang+rendah = total populasi", JSON.stringify(stats0));
  const LEVELS = ["Tinggi", "Sedang", "Rendah"];
  const FKEYS = ["rating", "trend", "pip", "tenure", "compa", "reward"];
  const structOk = rows0.length > 0 && rows0.every((r) =>
    typeof r.score === "number" && r.score >= 0 && r.score <= 100 &&
    LEVELS.includes(r.level) &&
    Array.isArray(r.factors) && r.factors.length === 6 &&
    FKEYS.every((k) => r.factors.some((f: Record<string, unknown>) => f.key === k)) &&
    r.factors.every((f: Record<string, unknown>) =>
      typeof f.score === "number" && typeof f.max === "number" && typeof f.available === "boolean" && typeof f.note === "string"));
  ok(structOk, "tiap baris: skor 0–100, level salah satu dari 3, factors[] 6 key dgn {score,max,available,note}");
  ok(list.json.disclaimer === "attrition-heuristic-explainable-not-ml",
    "disclaimer key D-BL11 selalu disertakan (string dwibahasa via t() di UI)", String(list.json.disclaimer));

  // ================= (b) DETERMINISTIK — Tuti Gunawan MII00013 =================
  console.log("\n[(b)] DETERMINISTIK — skor Tuti MII00013 dihitung manual dari db");
  const tuti = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00013" }, select: { id: true } });
  // rating: 2 siklus TERPUBLIKASI terakhir (periodEnd desc)
  const tutiAprs = await db.appraisalRecord.findMany({
    where: { employeeId: tuti.id, status: { in: ["Published", "Closed"] } },
    select: { finalRating: true, cycle: { select: { periodEnd: true } } },
    orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
  });
  const tutiLastRating = tutiAprs[0]?.finalRating ?? null;
  const tutiTwoCycles = tutiAprs.length >= 2
    && tutiAprs[0].finalRating != null && tutiAprs[1].finalRating != null;
  // pip
  const tutiPips = await db.pipPlan.findMany({ where: { employeeId: tuti.id }, select: { status: true } });
  const tutiPipOngoing = tutiPips.some((p) => p.status === "Active" || p.status === "Extended");
  const tutiPipNotRec = tutiPips.some((p) => p.status === "NotRecovered");
  // assignment aktif: gaji + grade; riwayat utk reward
  const tutiAsg = await db.employeeAssignment.findMany({
    where: { employeeId: tuti.id },
    orderBy: { validFrom: "desc" },
    select: { validFrom: true, validTo: true, changeReason: true, baseSalary: true, gradeId: true },
  });
  const tc = tenantCryptoForDb(db);
  const tutiActive = tutiAsg.find((a) => a.validTo == null);
  const tutiSalary = tutiActive ? tc.decryptMoney(tutiActive.baseSalary) : null;
  const tutiGrade = tutiActive?.gradeId
    ? await db.grade.findUniqueOrThrow({ where: { id: tutiActive.gradeId }, select: { code: true, minSalary: true, maxSalary: true } })
    : null;
  const tutiEmp = await db.employee.findUniqueOrThrow({ where: { id: tuti.id }, select: { joinDate: true } });

  const now = Date.now();
  // faktor rating (max 30)
  let expScore = 0;
  let expMax = 0;
  if (tutiLastRating != null) {
    expMax += 30;
    expScore += tutiLastRating <= 2 ? 30 : tutiLastRating === 3 ? 10 : 0;
  }
  // faktor trend (max 10 — butuh 2 siklus ber-rating)
  if (tutiTwoCycles) {
    expMax += 10;
    if ((tutiAprs[1].finalRating as number) - (tutiAprs[0].finalRating as number) >= 1) expScore += 10;
  }
  // faktor pip (max 20 — selalu tersedia)
  expMax += 20;
  expScore += tutiPipOngoing ? 20 : tutiPipNotRec ? 15 : 0;
  // faktor tenure (max 10)
  expMax += 10;
  expScore += expTenureScore((now - tutiEmp.joinDate.getTime()) / YEARS_MS);
  // faktor compa (max 15 — gaji & grade ada)
  if (tutiSalary != null && tutiGrade != null) {
    expMax += 15;
    expScore += expCompaScore(tutiSalary / ((tutiGrade.minSalary + tutiGrade.maxSalary) / 2));
  }
  // faktor reward (max 15 — selalu tersedia)
  expMax += 15;
  const tutiRewardAsg = tutiAsg.find((a) => ["Promotion", "SalaryAdjustment", "Mutation"].includes(a.changeReason));
  const tutiRewardFrom = (tutiRewardAsg?.validFrom ?? tutiEmp.joinDate).getTime();
  expScore += expRewardScore((now - tutiRewardFrom) / MONTHS_MS, tutiLastRating);
  const expectedTuti = Math.round((expScore / expMax) * 100);

  const tutiRow = rows0.find((r) => r.employeeNo === "MII00013");
  ok(!!tutiRow, "Tuti MII00013 ada di rows (punya appraisal terpublikasi)");
  ok(tutiRow != null && Math.abs((tutiRow.score as number) - expectedTuti) <= 1,
    `skor API Tuti = hitungan manual (${expectedTuti}) — toleransi ±1`,
    `api=${tutiRow?.score} manual=${expectedTuti} (rating=${tutiLastRating}, pip=${tutiPipOngoing ? "aktif" : tutiPipNotRec ? "NotRecovered" : "tidak ada"}, tenure=${((now - tutiEmp.joinDate.getTime()) / YEARS_MS).toFixed(1)}thn, compa=${tutiSalary != null && tutiGrade != null ? (tutiSalary / ((tutiGrade.minSalary + tutiGrade.maxSalary) / 2)).toFixed(2) : "N/A"}, reward=${tutiRewardAsg ? tutiRewardAsg.changeReason : "join"})`);
  ok(tutiRow != null && tutiRow.level === (expectedTuti >= 50 ? "Tinggi" : expectedTuti >= 25 ? "Sedang" : "Rendah"),
    "level Tuti konsisten dgn skor ekspektasi", `${tutiRow?.level}`);

  // ================= (c) NETRALISASI faktor data terbatas (D-BL11) =================
  console.log("\n[(c)] NETRALISASI — faktor tak tersedia keluar dari penyebut");
  const jokoRow = rows0.find((r) => r.employeeNo === "MII00005");
  ok(jokoRow != null, "Joko MII00005 (tanpa appraisal terpublikasi) ada di rows");
  if (jokoRow) {
    const fR = jokoRow.factors.find((f: Record<string, unknown>) => f.key === "rating");
    const fT = jokoRow.factors.find((f: Record<string, unknown>) => f.key === "trend");
    const maxAvail = (jokoRow.factors as Record<string, unknown>[])
      .filter((f) => f.available === true)
      .reduce((s, f) => s + (f.max as number), 0);
    ok(fR?.available === false && fT?.available === false && maxAvail < 100,
      "Joko: rating & trend available=false; Σmax TERSEDIA < 100 (faktor tak ikut penyebut)",
      `Σmax tersedia=${maxAvail}/100, skor=${jokoRow.score}`);
  }
  const sitiRow = rows0.find((r) => r.employeeNo === "MII00050");
  ok(sitiRow != null, "Siti MII00050 (tanpa grade) ada di rows");
  if (sitiRow) {
    const fC = sitiRow.factors.find((f: Record<string, unknown>) => f.key === "compa");
    ok(fC?.available === false, "Siti: faktor compa unavailable (grade null → dinetralkan)", String(fC?.note));
  }

  // ================= (d) AKSES (D-BL12) =================
  console.log("\n[(d)] AKSES — HR semua; Direksi semua; atasan hanya tim; ESS bukan atasan 403");
  const yLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
  ok(yLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${yLogin.status}`);
  const yusufEmp = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00010" }, select: { id: true } });
  const yusufSubs = await db.employeeAssignment.count({ where: { managerId: yusufEmp.id, validTo: null } });
  const essGet = await yusuf.api("GET", "/api/rekankerja/performance/talent");
  if (yusufSubs === 0) {
    ok(essGet.status === 403, "ESS yusuf (bukan atasan siapa pun — diverifikasi managerId via db) GET talent → 403",
      `HTTP ${essGet.status}, bawahan=${yusufSubs}`);
  } else {
    // bila ternyata atasan: hanya bawahannya yang boleh muncul
    const allowed = new Set((await db.employeeAssignment.findMany({
      where: { managerId: yusufEmp.id, validTo: null },
      select: { employeeId: true },
    })).map((a) => a.employeeId));
    ok(essGet.status === 200 && ((essGet.json.rows ?? []) as Record<string, string>[]).every((r) => allowed.has(r.employeeId)),
      "ESS yusuf (atasan) hanya melihat bawahannya langsung", `rows=${essGet.json.rows?.length}/${yusufSubs}`);
  }

  // service level (non-HTTP): atasan langsung → tim saja
  const joko = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00005" }, select: { id: true } });
  const jokoAllowed = new Set((await db.employeeAssignment.findMany({
    where: { managerId: joko.id, validTo: null },
    select: { employeeId: true },
  })).map((a) => a.employeeId));
  const team = await listAttritionRisk(db, { name: "Joko", employeeId: joko.id, isHr: false }, {});
  ok(team.scope === "team" && team.rows.length > 0 && team.rows.every((r) => jokoAllowed.has(r.employeeId)) && team.stats.total <= jokoAllowed.size,
    "service: atasan langsung (Joko — Production Manager) hanya melihat bawahannya (D-BL12)",
    `rows=${team.rows.length}/${jokoAllowed.size}, scope=${team.scope}`);

  // service level: Direksi → semua
  const hartono = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00001" }, select: { id: true } });
  const dir = await listAttritionRisk(db, { name: "Hartono", employeeId: hartono.id, isHr: false }, {});
  const activeCount = await db.employee.count({ where: { status: "Active" } });
  ok(dir.scope === "all" && dir.rows.length === activeCount,
    "service: Direksi (Hartono — Chief Executive Officer) melihat semua karyawan", `rows=${dir.rows.length}/${activeCount}`);

  // service level: karyawan biasa (bukan HR/Direksi/atasan) → 403
  const tutiPlain = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00013" }, select: { id: true } });
  let tutiForbidden = false;
  try {
    await listAttritionRisk(db, { name: "Tuti", employeeId: tutiPlain.id, isHr: false }, {});
  } catch (e) {
    tutiForbidden = e instanceof TalentForbiddenError && e.status === 403;
  }
  ok(tutiForbidden, "service: karyawan biasa (Tuti — bukan atasan/HR/Direksi) → TalentForbiddenError 403");

  // ================= (e) onlyHigh + injeksi PIP sementara =================
  console.log("\n[(e)] FILTER onlyHigh — injeksi PIP Active utk Budi MII00035 lalu bersih");
  const budi = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00035" }, select: { id: true } });
  const beforeBudi = rows0.find((r) => r.employeeNo === "MII00035");
  const pipTest = await db.pipPlan.create({ data: {
    docNo: `PIP-E2E-B3-${Date.now()}`,
    employeeId: budi.id,
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 86_400_000),
    targetsJson: "[]",
    reviewerId: joko.id,
    status: "Active",
  } });
  try {
    const onlyHigh = await owner.api("GET", "/api/rekankerja/performance/talent?onlyHigh=1");
    const hiRows = (onlyHigh.json.rows ?? []) as Record<string, any>[];
    ok(onlyHigh.status === 200 && hiRows.length >= 1 && hiRows.every((r) => r.level === "Tinggi"),
      "onlyHigh=1 → semua baris level Tinggi (Budi naik melewati 50 via PIP aktif +20)",
      `HTTP ${onlyHigh.status}, rows=${hiRows.length}, skor Budi sebelum=${beforeBudi?.score}`);
    const budiHigh = hiRows.find((r) => r.employeeNo === "MII00035");
    ok(budiHigh != null && budiHigh.score >= 50, "Budi MII00035 muncul di onlyHigh dgn skor ≥ 50", `skor=${budiHigh?.score}`);
    const fPip = budiHigh?.factors.find((f: Record<string, unknown>) => f.key === "pip");
    ok(fPip?.score === 20 && fPip?.available === true, "faktor pip Budi = 20/20 (PIP aktif)", JSON.stringify(fPip));
  } finally {
    await db.pipPlan.delete({ where: { id: pipTest.id } });
  }
  const pipGone = await db.pipPlan.count({ where: { id: pipTest.id } });
  ok(pipGone === 0, "PIP uji dibersihkan (service stateless — tanpa jejak data uji)");
  const after = await owner.api("GET", "/api/rekankerja/performance/talent?q=MII00035");
  const budiAfter = ((after.json.rows ?? []) as Record<string, any>[])[0];
  ok(after.status === 200 && budiAfter != null && budiAfter.score === beforeBudi?.score && budiAfter.level === beforeBudi?.level,
    "pasca-cleanup: skor Budi kembali seperti semula (deterministik on-read)",
    `${budiAfter?.score}/${budiAfter?.level} vs sebelumnya ${beforeBudi?.score}/${beforeBudi?.level}`);

  console.log(`\n================ HASIL: ${pass}/${pass + fail} ================`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
