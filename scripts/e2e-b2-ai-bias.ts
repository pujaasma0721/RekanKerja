// Uji E2E API B2 (AI Ringkasan Check-in + Deteksi Bias Bahasa) per
// DEVELOPMENT-PLAN-BACKLOG.md §4 B2 / D-BL6…D-BL9 — di atas data demo MII
// (login owner hrd@mii.co.id; ESS yusuf@mii.co.id):
//   (a) UNIT LEXICON: 7 frasa bermasalah (ID+EN) ter-flag dgn kategori benar;
//       3 frasa sehat → 0 flag (termasuk kata-sound-alike "perlu bimbingan
//       teknis").
//   (b) JALUR 360: invite 3 reviewer pada PER-2026-005 (siklus PER-2026
//       Assessment, 360 aktif) → submit ESS dgn 1 komentar ter-flag → respons
//       biasWarnings + answer moderated=Pending + flaggedJson; 2 reviewer
//       lain submit bersih (panggilan service langsung); aggregate360
//       MENYEMBUNYIKAN komentar Pending; antrean HR flag=1 (tanpa identitas
//       reviewer); HR APPROVE → komentar muncul; re-submit reviewer (status
//       di-reopen) dgn frasa beda → Pending lagi → HR aiScan advisori (200 +
//       ActivityLog AiBiasScan) → HR REDACT → tampil "[dikensorkan oleh HR —
//       potensi bias]" (isi TIDAK bocor).
//   (c) RINGKASAN CHECK-IN: admin schedule+log (Held) utk appraisal ESS
//       yusuf → ESS aiSummary sendiri → 200 + summary non-kosong +
//       ActivityLog AiCheckinSummary; admin aiSummary → 200; injeksi 20
//       ActivityLog → panggilan berikutnya 400 rate-limit.
//   (d) GUARD: ESS ringkas check-in orang lain → 403; antrean moderasi &
//       moderate oleh non-HR (ESS) → 403.
//   (e) BIAS ADVISORI PENILAIAN ATASAN: saveManagerScore dgn komentar ter-flag
//       → respons memuat biasWarnings, komentar TETAP tersimpan (tidak diblokir).
// Jalankan: bun run scripts/e2e-b2-ai-bias.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { scanBias } from "@/rekankerja/performance/services/bias-lexicon";
import { submit360, REDACTED_360_COMMENT } from "@/rekankerja/performance/services/perf-360-service";

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

const BIAS_COMMENT_1 = "Kerjanya asal-asalan dan dasar bodoh — beban kantor.";
const BIAS_COMMENT_2 = "Perempuan kok minta naik jabatan.";
const CLEAN_COMMENT = "Kolaborasi lintas tim sudah membaik kuartal ini.";

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const yusuf = new Sesi();

  // ================= (a) UNIT LEXICON — deterministik =================
  console.log("\n[(a)] UNIT LEXICON bias-lexicon.ts (pure, deterministik)");
  {
    const f1 = scanBias(BIAS_COMMENT_1);
    ok(f1.length >= 2 && f1.some((x) => x.category === "SeranganPribadi"), "ID 'dasar bodoh'/'beban kantor' ter-flag SeranganPribadi", JSON.stringify(f1.map((x) => `${x.category}:${x.phrase}`)));
    const f2 = scanBias("Orang jawa begitu memang pelan kerjanya.");
    ok(f2.some((x) => x.category === "SARA" && /orang jawa/.test(x.phrase)), "ID 'orang jawa begitu' ter-flag SARA (suku)");
    const f3 = scanBias("Perempuan kok bisa masuk tim ini?");
    ok(f3.some((x) => x.category === "SARA" && /perempuan/.test(x.phrase)), "ID 'perempuan kok' ter-flag SARA (gender)");
    const f4 = scanBias("He is useless and just a token hire.");
    ok(f4.some((x) => x.phrase === "useless") && f4.some((x) => x.phrase === "token hire"), "EN 'useless' + 'token hire' ter-flag (SeranganPribadi + SARA)");
    const f5 = scanBias("Selamat ya, bisa sekali telat lagi.");
    ok(f5.some((x) => x.category === "Sarkasme" && x.phrase === "selamat ya"), "ID sarkasme 'selamat ya, bisa sekali telat' ter-flag Sarkasme");
    const f6 = scanBias("Dia terlalu tua untuk proyek ini.");
    ok(f6.some((x) => x.category === "SARA" && /tua/.test(x.phrase)), "ID 'terlalu tua' ter-flag SARA (usia)");
    const f7 = scanBias("Goblok sekali kerjanya.");
    ok(f7.some((x) => x.category === "Kasar" && x.phrase === "goblok"), "ID 'goblok' ter-flag Kasar");
    const s1 = scanBias("Perlu bimbingan teknis di modul pelaporan.");
    ok(s1.length === 0, "frasa sehat 'perlu bimbingan teknis' → 0 flag");
    const s2 = scanBias("Komunikasi ke tim sudah membaik kuartal ini.");
    ok(s2.length === 0, "frasa sehat 'komunikasi membaik' → 0 flag");
    const s3 = scanBias("Dia memerlukan bimbingan teknis lanjutan.");
    ok(s3.length === 0, "frasa sehat (sound-alike) → 0 flag");
  }

  // ================= (b) JALUR 360 — flag → moderasi → agregat =================
  console.log("\n[(b)] JALUR 360 — flag → antrean HR → approve → re-submit → redact");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const appr505 = await db.appraisalRecord.findFirstOrThrow({ where: { docNo: "PER-2026-005" }, select: { id: true, employeeId: true } });
  const cycle26 = await db.performanceCycle.findFirstOrThrow({ where: { code: "PER-2026" }, select: { id: true, status: true, feedback360: true } });
  const yusufEmp = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00010" }, select: { id: true, fullName: true } });
  const hartono = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00001" }, select: { id: true, fullName: true } });
  const sri = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00002" }, select: { id: true, fullName: true } });

  // RESET idempoten — bersihkan undangan uji & jawaban utk 3 reviewer ini
  await db.feedback360Answer.deleteMany({ where: { feedback: { appraisalId: appr505.id, reviewerId: { in: [yusufEmp.id, hartono.id, sri.id] } } } });
  await db.feedback360.deleteMany({ where: { appraisalId: appr505.id, reviewerId: { in: [yusufEmp.id, hartono.id, sri.id] } } });

  // undang 3 reviewer (HR superadmin — atasan snapshot/HR)
  const inv = await owner.api("POST", "/api/rekankerja/performance/feedback360", {
    action: "invite", appraisalId: appr505.id,
    reviewers: [
      { employeeId: yusufEmp.id, reviewerType: "Peer" },
      { employeeId: hartono.id, reviewerType: "Peer" },
      { employeeId: sri.id, reviewerType: "Subordinate" },
    ],
    dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  });
  ok(inv.status === 200 && (inv.json.report?.invited ?? []).length === 3, "invite 3 reviewer 360 → 3 terkirim", `HTTP ${inv.status}`);
  const fbYusuf = await db.feedback360.findFirstOrThrow({ where: { appraisalId: appr505.id, reviewerId: yusufEmp.id }, select: { id: true } });
  const fbHartono = await db.feedback360.findFirstOrThrow({ where: { appraisalId: appr505.id, reviewerId: hartono.id }, select: { id: true } });
  const fbSri = await db.feedback360.findFirstOrThrow({ where: { appraisalId: appr505.id, reviewerId: sri.id }, select: { id: true } });

  const comps = await db.appraisalCompetencyScore.findMany({ where: { appraisalId: appr505.id }, select: { id: true, competencyId: true } });
  const compIds = comps.map((c) => c.competencyId);
  const targetCompId = compIds[0];

  // ESS yusuf submit — 1 komentar ter-flag (kompetensi pertama), lainnya bersih
  const yLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
  ok(yLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${yLogin.status}`);

  const submit1 = await yusuf.api("POST", "/api/rekankerja/ess/my-360", {
    action: "submit", id: fbYusuf.id,
    answers: compIds.map((cid, i) => ({
      competencyId: cid, score: 4,
      comment: i === 0 ? BIAS_COMMENT_1 : (i === 1 ? CLEAN_COMMENT : undefined),
    })),
  });
  ok(submit1.status === 201 && (submit1.json.biasWarnings ?? []).some((w: { phrase: string }) => w.phrase === "dasar bodoh"),
    "submit ESS dgn komentar ter-flag → 201 + biasWarnings advisori (submit TETAP berhasil)", `HTTP ${submit1.status}`);
  const flaggedAns = await db.feedback360Answer.findFirstOrThrow({ where: { feedbackId: fbYusuf.id, competencyId: targetCompId }, select: { id: true, flaggedJson: true, moderated: true } });
  ok(flaggedAns.moderated === "Pending" && !!flaggedAns.flaggedJson && flaggedAns.flaggedJson.includes("dasar bodoh"),
    "answer ter-flag tersimpan moderated=Pending + flaggedJson", `moderated=${flaggedAns.moderated}`);
  const cleanAns = await db.feedback360Answer.findFirstOrThrow({ where: { feedbackId: fbYusuf.id, competencyId: compIds[1] }, select: { moderated: true, flaggedJson: true } });
  ok(cleanAns.moderated === "Approved" && cleanAns.flaggedJson === null, "answer bersih langsung moderated=Approved (null flaggedJson)");

  // 2 reviewer lain submit bersih (panggilan service langsung — non-HTTP utk
  // mengisolasi jalur agregasi; reviewer tak punya akun ESS demo)
  await submit360(db, hartono.id, fbHartono.id, compIds.map((cid, i) => ({ competencyId: cid, score: i % 2 ? 3 : 4, comment: i === 0 ? CLEAN_COMMENT : undefined })));
  await submit360(db, sri.id, fbSri.id, compIds.map((cid) => ({ competencyId: cid, score: 4 })));
  ok(true, "2 reviewer lain submit bersih (3 Submitted total — ambang anonimitas ≥3 terpenuhi)");

  // agregat menyembunyikan komentar Pending (D-BL7b)
  const d1 = await owner.api("GET", `/api/rekankerja/performance/appraisals?id=${appr505.id}`);
  const pc1 = ((d1.json.feedback360?.perCompetency ?? []) as { competencyId: string; comments: string[] | null }[]).find((p) => p.competencyId === targetCompId);
  ok(d1.status === 200 && pc1 != null && (pc1.comments ?? []).every((c) => !c.includes("dasar bodoh")),
    "aggregate360 MENYEMBUNYIKAN komentar Pending (isi tidak bocor ke atasan)");
  ok((pc1?.comments ?? []).some((c) => c.includes("Kolaborasi lintas tim")), "aggregate360 komentar bersih tetap tampil");

  // antrean moderasi HR — TANPA identitas reviewer
  const q1 = await owner.api("GET", `/api/rekankerja/performance/feedback360?flagged=1&cycleId=${cycle26.id}`);
  const qRow = ((q1.json.rows ?? []) as Record<string, unknown>[]).find((r) => r.id === flaggedAns.id);
  ok(q1.status === 200 && !!qRow, "antrean HR ?flagged=1 memuat komentar Pending");
  const identityKeys = ["reviewerId", "reviewerName", "reviewerNo", "reviewer"].filter((k) => k in (qRow ?? {}));
  ok(identityKeys.length === 0 && (qRow?.flagged as { phrase: string }[])?.some?.((f) => f.phrase === "dasar bodoh"),
    "antrean TANPA identitas reviewer (anonimitas utuh) + flag {category,phrase}", JSON.stringify(identityKeys));

  // HR APPROVE → komentar muncul di agregat
  const mod1 = await owner.api("POST", "/api/rekankerja/performance/feedback360", { action: "moderate", answerId: flaggedAns.id, decision: "Approved" });
  ok(mod1.status === 200 && mod1.json.moderated === "Approved", "HR approve komentar Pending → 200");
  const d2 = await owner.api("GET", `/api/rekankerja/performance/appraisals?id=${appr505.id}`);
  const pc2 = ((d2.json.feedback360?.perCompetency ?? []) as { competencyId: string; comments: string[] | null }[]).find((p) => p.competencyId === targetCompId);
  ok((pc2?.comments ?? []).some((c) => c.includes("dasar bodoh")), "pasca-approve: komentar tampil normal ter-agregat");

  // re-submit reviewer (undangan di-reopen) dgn frasa bias berbeda → Pending lagi
  await db.feedback360.update({ where: { id: fbYusuf.id }, data: { status: "Invited" } });
  const submit2 = await yusuf.api("POST", "/api/rekankerja/ess/my-360", {
    action: "submit", id: fbYusuf.id,
    answers: compIds.map((cid, i) => ({ competencyId: cid, score: 3, comment: i === 0 ? BIAS_COMMENT_2 : (i === 1 ? CLEAN_COMMENT : undefined) })),
  });
  ok(submit2.status === 201 && (submit2.json.biasWarnings ?? []).some((w: { phrase: string }) => w.phrase === "perempuan kok"),
    "re-submit dgn frasa bias kedua → 201 + biasWarnings 'perempuan kok'");
  const flagged2 = await db.feedback360Answer.findFirstOrThrow({ where: { feedbackId: fbYusuf.id, moderated: "Pending" }, select: { id: true } });

  // HR aiScan advisori (D-BL8) → 200 + ActivityLog (tanpa isi teks)
  const scan = await owner.api("POST", "/api/rekankerja/performance/feedback360", { action: "aiScan", answerId: flagged2.id, lang: "id" });
  ok(scan.status === 200 && typeof scan.json.scan === "string" && (scan.json.scan ?? "").length > 10,
    "HR aiScan komentar Pending → 200 + hasil advisori non-kosong", `unavailable=${scan.json.unavailable ?? false}`);
  const scanLog = await db.activityLog.findFirst({ where: { action: "AiBiasScan", entity: "Feedback360Answer", entityId: flagged2.id } });
  ok(!!scanLog && !(scanLog?.detail ?? "").includes(BIAS_COMMENT_2), "ActivityLog AiBiasScan tercatat TANPA isi teks komentar");

  // HR REDACT → agregat tampil string sensor (isi tidak dibocorkan)
  const mod2 = await owner.api("POST", "/api/rekankerja/performance/feedback360", { action: "moderate", answerId: flagged2.id, decision: "Redacted" });
  ok(mod2.status === 200 && mod2.json.moderated === "Redacted", "HR redact komentar → 200");
  const d3 = await owner.api("GET", `/api/rekankerja/performance/appraisals?id=${appr505.id}`);
  const pc3 = ((d3.json.feedback360?.perCompetency ?? []) as { competencyId: string; comments: string[] | null }[]).find((p) => p.competencyId === targetCompId);
  ok((pc3?.comments ?? []).some((c) => c === REDACTED_360_COMMENT), "komentar ter-redaksi tampil string sensor tetap");
  ok((pc3?.comments ?? []).every((c) => !c.includes("perempuan kok")), "isi asli komentar ter-redaksi TIDAK bocor");

  // ================= (d) GUARD non-HR / anti-IDOR 360 =================
  const essFlag = await yusuf.api("GET", `/api/rekankerja/performance/feedback360?flagged=1&cycleId=${cycle26.id}`);
  ok(essFlag.status === 403, "ESS (non-admin) akses antrean moderasi → 403", `HTTP ${essFlag.status}`);
  const essMod = await yusuf.api("POST", "/api/rekankerja/performance/feedback360", { action: "moderate", answerId: flagged2.id, decision: "Approved" });
  ok(essMod.status === 403, "moderate oleh non-HR (ESS) → 403", `HTTP ${essMod.status}`);

  // ================= (c) RINGKASAN CHECK-IN AI (D-BL6) =================
  console.log("\n[(c)] RINGKASAN CHECK-IN — on-demand stateless (D-BL6)");
  const appr002 = await db.appraisalRecord.findFirstOrThrow({ where: { docNo: "PER-2026-002" }, select: { id: true, employeeId: true } });
  const sched = await owner.api("POST", "/api/rekankerja/performance/checkins", {
    action: "schedule", appraisalId: appr002.id, heldAt: new Date().toISOString().slice(0, 10), agenda: "E2E B2 ringkasan AI",
  });
  ok(sched.status === 201 && !!sched.json.id, "admin jadwalkan check-in utk appraisal ESS yusuf", `HTTP ${sched.status}`);
  const ciId = sched.json.id as string;
  const logged = await owner.api("POST", "/api/rekankerja/performance/checkins", {
    action: "log", id: ciId,
    wins: ["Menyelesaikan migrasi data pelanggan", "Dokumentasi prosedur tim diperbarui"],
    blockers: ["Menunggu akses sistem vendor"],
    next: ["Latih 2 anggota tim baru", "Rapikan backlog tiket"],
    managerComment: "Progres stabil — pertahankan ritme komunikasi mingguan.",
  });
  ok(logged.status === 200, "admin catat hasil check-in (Held)", `HTTP ${logged.status}`);

  const essSum = await yusuf.api("POST", "/api/rekankerja/ess/my-checkins", { action: "aiSummary", id: ciId, lang: "id" });
  ok(essSum.status === 200 && typeof essSum.json.summary === "string" && (essSum.json.summary ?? "").length > 20 && !essSum.json.unavailable,
    "ESS aiSummary check-in MILIK SENDIRI → 200 + summary non-kosong", `len=${(essSum.json.summary ?? "").length}`);
  const sumLog = await db.activityLog.findFirst({ where: { action: "AiCheckinSummary", entity: "CheckIn", entityId: ciId } });
  ok(!!sumLog, "ActivityLog AiCheckinSummary tercatat (audit stateless)");

  // GUARD anti-IDOR: yusuf meringkas check-in peserta lain (PER-2026-001 Dedi) → 403
  const otherCi = await db.checkIn.findFirstOrThrow({ where: { status: "Held", appraisal: { docNo: "PER-2026-001" } }, select: { id: true } });
  const essOther = await yusuf.api("POST", "/api/rekankerja/ess/my-checkins", { action: "aiSummary", id: otherCi.id, lang: "id" });
  ok(essOther.status === 403, "ESS ringkas check-in ORANG LAIN → 403 (anti-IDOR)", `HTTP ${essOther.status}`);

  // admin aiSummary → 200 (menu performance:checkins — HR boleh semua peserta)
  const admSum = await owner.api("POST", "/api/rekankerja/performance/checkins", { action: "aiSummary", checkInId: ciId, lang: "id" });
  ok(admSum.status === 200 && typeof admSum.json.summary === "string" && (admSum.json.summary ?? "").length > 20,
    "admin aiSummary → 200 + summary non-kosong", `len=${(admSum.json.summary ?? "").length}`);

  // RATE-LIMIT 20/jam (D-BL8) — injeksi 20 ActivityLog utk employeeId HR
  const hrdUser = await db.appUser.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true, employeeId: true } });
  const MARK = `e2e-b2-rl-${Date.now()}`;
  for (let i = 0; i < 20; i++) {
    await db.activityLog.create({ data: { actorType: "user", employeeId: hrdUser.employeeId, action: "AiCheckinSummary", entity: "CheckIn", entityId: `${MARK}-${i}`, detail: `Injeksi rate-limit B2 (${i + 1}/20)` } });
  }
  const rl = await owner.api("POST", "/api/rekankerja/performance/checkins", { action: "aiSummary", checkInId: ciId, lang: "id" });
  ok(rl.status === 400 && /Batas 20 ringkasan AI per jam/i.test(rl.json.error ?? ""), "panggilan ke-21 → 400 rate-limit", String(rl.json.error));
  const del = await db.activityLog.deleteMany({ where: { entityId: { startsWith: MARK } } });
  ok(del.count === 20, "injeksi ActivityLog dibersihkan", `${del.count} baris`);

  // ================= (e) BIAS ADVISORI SUBMIT PENILAIAN ATASAN =================
  console.log("\n[(e)] BIAS ADVISORI — saveManagerScore (D-BL7a, NON-BLOKIR)");
  const origMgrStart = cycle26 ? await db.performanceCycle.findUniqueOrThrow({ where: { id: cycle26.id }, select: { mgrStart: true } }) : null;
  await db.performanceCycle.update({ where: { id: cycle26.id }, data: { mgrStart: new Date("2026-10-01T00:00:00.000Z") } }); // buka jendela utk uji
  const appr001 = await db.appraisalRecord.findFirstOrThrow({ where: { docNo: "PER-2026-001" }, select: { id: true } });
  const compRow = await db.appraisalCompetencyScore.findFirstOrThrow({ where: { appraisalId: appr001.id }, select: { id: true, competencyId: true, comment: true } });
  try {
    const mgr = await owner.api("POST", "/api/rekankerja/performance/appraisals", {
      action: "saveManagerScore", appraisalId: appr001.id,
      compComments: [{ compId: compRow.id, comment: BIAS_COMMENT_1 }],
    });
    ok(mgr.status === 200 && (mgr.json.biasWarnings ?? []).some((w: { phrase: string }) => w.phrase === "dasar bodoh"),
      "saveManagerScore dgn komentar ter-flag → 200 + biasWarnings advisori", `HTTP ${mgr.status}`);
    const saved = await db.appraisalCompetencyScore.findUniqueOrThrow({ where: { id: compRow.id }, select: { comment: true } });
    ok((saved.comment ?? "").includes("dasar bodoh"), "komentar TETAP tersimpan (deteksi bias TIDAK memblokir)");
  } finally {
    await db.appraisalCompetencyScore.update({ where: { id: compRow.id }, data: { comment: compRow.comment } });
    await db.performanceCycle.update({ where: { id: cycle26.id }, data: { mgrStart: origMgrStart?.mgrStart ?? null } });
  }

  // ================= CLEANUP =================
  console.log("\n[CLEANUP] data uji B2");
  await db.feedback360Answer.deleteMany({ where: { feedbackId: { in: [fbYusuf.id, fbHartono.id, fbSri.id] } } });
  await db.feedback360.deleteMany({ where: { id: { in: [fbYusuf.id, fbHartono.id, fbSri.id] } } });
  await db.activityLog.deleteMany({ where: { entity: "Feedback360", entityId: { in: [fbYusuf.id, fbHartono.id, fbSri.id] } } });
  await db.activityLog.deleteMany({ where: { entity: "Feedback360Answer", entityId: { in: [flaggedAns.id, flagged2.id] } } });
  await db.checkIn.delete({ where: { id: ciId } });
  await db.activityLog.deleteMany({ where: { entity: "CheckIn", entityId: ciId } });
  const fbGone = await db.feedback360.count({ where: { id: { in: [fbYusuf.id, fbHartono.id, fbSri.id] } } });
  ok(fbGone === 0, "undangan & jawaban uji 360 dibersihkan");
  const ciGone = await db.checkIn.count({ where: { id: ciId } });
  ok(ciGone === 0, "check-in uji dibersihkan");

  console.log(`\n================ HASIL: ${pass}/${pass + fail} ================`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
