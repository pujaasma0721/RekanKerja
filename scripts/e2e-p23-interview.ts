// Uji E2E P2.3 (Panel interview + self-schedule + .ics — DEVELOPMENT-PLAN-
// BENCHMARK.md §2 D-BM18 + §4 P2.3, Recruitment §4.5 gap-2) — di atas data
// demo MII:
//   (0) SETUP: login HR owner; pilih kandidat aktif InProcess/Nominated yang
//       punya email pelamar (fallback: kandidat aktif mana pun bermotor);
//       step aktifnya dijadikan target (fallback action add-step). 3 evaluator
//       aktif dipilih dari karyawan dengan AppUser aktif (notifikasi terukur)
//       dan tanpa scorecard existing di step. Snapshot state step pra-uji.
//   (1) BACKWARD-COMPAT: schedule dgn performedById TUNGGAL (pemanggil lama)
//       → performedById ter-set, panel evaluator TIDAK dibuat.
//   (2) PANEL: schedule dgn evaluatorIds 3 karyawan → 3 baris
//       CandidateStepEvaluator + performedById == lead + notifikasi in-app
//       3 evaluator (Notification rows — email evaluator fire-and-forget,
//       tidak di-assert).
//   (3) SLOT: invite-slots tanpa slot → 400; slots-save validasi (masa lalu →
//       400, tumpang tindih → 400); slots-save 3 slot (H+1..H+3) → invite-slots
//       → link token; step.inviteTokenHash terisi (prisma).
//   (4) PUBLIC GET ?token=&t= → 200 {ok, position, tahap, slots:3} TANPA PII
//       (nama evaluator/kandidat); token acak → 404.
//   (5) PUBLIC POST book slot ke-2 → 200; slot2 Booked + slot1/3 Closed +
//       step.planDate == slot2.startAt + dueDate = plan + SLA master; EmailLog
//       event "recruitment.interview.booked" (await path); parse output
//       buildInterviewIcs: BEGIN:VCALENDAR + DTSTART UTC sesuai slot2 + CRLF.
//   (6) DOUBLE-BOOK slot2 (token masih valid) → 409.
//   (7) BACKDATE inviteTokenExpAt via prisma → POST → 410.
//   (8) SCORECARD: 2 evaluator beda skor ekstrem (5 vs 2 → gap 3 > 2) →
//       GET ?stepId=&scorecards=1 → panel + slots + divergence true
//       (jalur existing tidak rusak oleh evaluatorIds).
//   (9) GUARD: ESS POST slots-save → 403 (menu-guard op:schedule).
// CLEANUP: hapus panel evaluator + slots + scorecard uji + notifikasi uji;
//       restore field step pra-uji (EmailLog/ActivityLog DIPERTAHANKAN — pola B8).
// Jalankan: bun scripts/e2e-p23-interview.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { buildInterviewIcs } from "@/rekankerja/recruitment/services/selection-service";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const ESS_EMAIL = "yusuf@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const TENANT_SLUG = "pt-mitra-industri-internasional";
const SELECTION_API = "/api/rekankerja/recruitment/selection";
const PUBLIC_API = "/api/public/recruitment/interview-slots";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Poll hingga kondisi true (notifikasi in-app fire-and-forget) — diam saat timeout. */
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 12_000): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 600));
  }
}

class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
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
        const text = await res.text();
        let json: any = {};
        try { json = JSON.parse(text); } catch { /* keep */ }
        return { status: res.status, json, text };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

/** Slot ISO "besok/H+n pukul 10:00 UTC". */
function slotIso(daysAhead: number, hourUtc = 10): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

function icsUtcBasic(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}Z`;
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const tc = tenantCryptoForDb(db);
  const hr = new Sesi();
  const ess = new Sesi();
  const startedAt = new Date();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + fixture kandidat/step/evaluator");
  const loginHr = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(loginHr.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${loginHr.status}`);
  const loginEss = await ess.api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(loginEss.status === 200, `login ESS ${ESS_EMAIL}`, `HTTP ${loginEss.status}`);

  // kandidat aktif dengan email pelamar terbaca (utk assert EmailLog booked)
  const activeCands = await db.jobCandidate.findMany({
    where: { status: { in: ["Nominated", "InProcess"] } },
    include: {
      selectionSteps: { orderBy: { seqNo: "asc" }, include: { selectionProcess: { select: { id: true, name: true, slaDays: true } } } },
      pr: { select: { prNo: true, status: true } },
    },
    orderBy: { nominatedAt: "desc" },
    take: 30,
  });
  let target: (typeof activeCands)[number] | null = null;
  for (const c of activeCands) {
    if (!c.applicantId) continue;
    const a = await db.applicant.findUnique({ where: { id: c.applicantId }, select: { email: true } });
    if (a?.email && tc.decryptText(a.email)?.includes("@")) { target = c; break; }
  }
  ok(!!target, "kandidat aktif dengan email pelamar ditemukan (data demo MII)", target ? `${target.fullName} · ${target.pr.prNo}` : "—");

  let step = target ? target.selectionSteps.find((s) => !["Passed", "Failed", "Cancelled"].includes(s.status)) ?? null : null;
  let stageName = step?.selectionProcess.name ?? "";
  let slaDays = step?.selectionProcess.slaDays ?? null;
  if (!step && target) {
    // fallback: tambah tahap baru (action add-step) bila rantai terminal semua
    const inChain = new Set(target.selectionSteps.map((s) => s.selectionProcessId));
    const fresh = await db.selectionProcess.findFirst({ where: { active: true, id: { not: { in: [...inChain] } } }, orderBy: { processOrder: "asc" } });
    if (fresh) {
      const r = await hr.api("POST", SELECTION_API, { action: "add-step", candidateId: target.id, selectionProcessId: fresh.id });
      ok(r.status === 200, "fallback add-step → tahap baru dibuat", `HTTP ${r.status}`);
      step = await db.candidateSelectionStep.findUnique({ where: { id: r.json?.id }, include: { selectionProcess: true } });
      stageName = step?.selectionProcess.name ?? "";
      slaDays = step?.selectionProcess.slaDays ?? null;
    }
  }
  ok(!!step, "step target tersedia", step ? `#${step.seqNo} ${stageName}` : "—");
  if (!step || !target) {
    console.log(`\nHASIL: ${pass}/${pass + fail} — fixture tidak tersedia, hentikan.`);
    process.exit(1);
  }
  const stepId = step.id;

  // 3 evaluator: karyawan aktif DENGAN AppUser aktif (notifikasi terukur),
  // tanpa scorecard existing di step ini.
  const auEmps = await db.appUser.findMany({ where: { active: true, employeeId: { not: null } }, select: { employeeId: true }, take: 30 });
  const candIds = [...new Set(auEmps.map((a) => a.employeeId as string))];
  const pool = await db.employee.findMany({
    where: { id: { in: candIds }, status: "Active" },
    select: { id: true, employeeNo: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const existingSc = await db.candidateScorecard.findMany({ where: { selectionStepId: stepId }, select: { evaluatorId: true } });
  const takenEv = new Set(existingSc.map((s) => s.evaluatorId));
  const evaluators = pool.filter((e) => !takenEv.has(e.id)).slice(0, 3);
  ok(evaluators.length === 3, "3 evaluator aktif (dengan AppUser, tanpa scorecard di step) tersedia",
    evaluators.map((e) => e.fullName).join(", "));

  // snapshot step pra-uji + pre-clean artefak run lama
  const stepBefore = await db.candidateSelectionStep.findUnique({ where: { id: stepId } });
  if (!stepBefore) { console.log("step hilang — hentikan"); process.exit(1); }
  const preSlots = await db.interviewSlot.count({ where: { selectionStepId: stepId } });
  const prePanel = await db.candidateStepEvaluator.count({ where: { selectionStepId: stepId } });
  if (preSlots > 0) await db.interviewSlot.deleteMany({ where: { selectionStepId: stepId } });
  if (prePanel > 0) await db.candidateStepEvaluator.deleteMany({ where: { selectionStepId: stepId } });
  if (preSlots > 0 || prePanel > 0) console.log(`  pre-clean: ${preSlots} slot + ${prePanel} panel uji run lama dihapus`);

  // ================= (1) BACKWARD-COMPAT schedule lama =================
  console.log("\n[(1)] BACKWARD-COMPAT — schedule performedById tunggal (pemanggil lama)");
  const legacyAt = slotIso(1, 9);
  const rLegacy = await hr.api("POST", SELECTION_API, {
    action: "schedule", stepId, planDate: legacyAt, performedById: evaluators[0]?.id ?? null, meetingUrl: null,
  });
  ok(rLegacy.status === 200, "schedule performedById saja → 200", `HTTP ${rLegacy.status}${rLegacy.json?.error ? ` — ${rLegacy.json.error}` : ""}`);
  const afterLegacy = await db.candidateSelectionStep.findUnique({ where: { id: stepId } });
  ok(afterLegacy?.performedById === evaluators[0]?.id, "performedById ter-set (lead tunggal)", afterLegacy?.performedById ?? "—");
  ok((await db.candidateStepEvaluator.count({ where: { selectionStepId: stepId } })) === 0, "panel evaluator TIDAK dibuat pemanggil lama (backward-compat)");

  // ================= (2) PANEL EVALUATOR =================
  console.log("\n[(2)] PANEL — schedule evaluatorIds 3 evaluator → 3 baris panel + notifikasi");
  const panelAt = slotIso(1, 11);
  const rPanel = await hr.api("POST", SELECTION_API, {
    action: "schedule", stepId, planDate: panelAt,
    evaluatorIds: evaluators.map((e) => e.id),
    meetingUrl: null,
  });
  ok(rPanel.status === 200, "schedule evaluatorIds[3] → 200", `HTTP ${rPanel.status}${rPanel.json?.error ? ` — ${rPanel.json.error}` : ""}`);
  const panelRows = await db.candidateStepEvaluator.findMany({ where: { selectionStepId: stepId } });
  ok(panelRows.length === 3, "3 baris CandidateStepEvaluator", `${panelRows.length} baris`);
  const afterPanel = await db.candidateSelectionStep.findUnique({ where: { id: stepId } });
  ok(afterPanel?.performedById === evaluators[0]?.id, "performedById == lead (evaluatorIds[0])", afterPanel?.performedById ?? "—");

  let notifOk = false;
  await waitFor(async () => {
    const n = await db.notification.count({
      where: {
        title: { contains: "Jadwal seleksi baru" },
        createdAt: { gte: startedAt },
      },
    });
    notifOk = n >= 3;
    return notifOk;
  });
  ok(notifOk, "≥3 Notification rows (title \"Jadwal seleksi baru — {stage}\" + 3 evaluator)");

  // ================= (3) SLOT + UNDANGAN TOKEN =================
  console.log("\n[(3)] SLOT — invite tanpa slot → 400; validasi; slots-save ×3; invite-slots");
  const rInvite0 = await hr.api("POST", SELECTION_API, { action: "invite-slots", stepId });
  ok(rInvite0.status === 400, "invite-slots tanpa slot Open → 400", `HTTP ${rInvite0.status}`);

  const rPast = await hr.api("POST", SELECTION_API, { action: "slots-save", stepId, slots: [{ startAt: new Date(Date.now() - 3_600_000).toISOString(), durationMin: 60 }] });
  ok(rPast.status === 400, "slots-save waktu lampau → 400", `HTTP ${rPast.status} — ${rPast.json?.error?.slice(0, 50) ?? ""}`);
  const t1 = slotIso(1, 10);
  const rOverlap = await hr.api("POST", SELECTION_API, { action: "slots-save", stepId, slots: [{ startAt: t1, durationMin: 90 }, { startAt: t1, durationMin: 60 }] });
  ok(rOverlap.status === 400, "slots-save tumpang tindih → 400", `HTTP ${rOverlap.status}`);

  const s1 = slotIso(1, 10); // H+1 10:00 UTC
  const s2 = slotIso(2, 10); // H+2 10:00 UTC
  const s3 = slotIso(3, 10); // H+3 10:00 UTC
  const rSave = await hr.api("POST", SELECTION_API, {
    action: "slots-save", stepId,
    slots: [{ startAt: s1, durationMin: 60 }, { startAt: s2, durationMin: 60 }, { startAt: s3, durationMin: 90 }],
  });
  ok(rSave.status === 200 && rSave.json?.count === 3, "slots-save 3 slot (H+1..H+3) → 200", `HTTP ${rSave.status} count=${rSave.json?.count}`);

  const rInvite = await hr.api("POST", SELECTION_API, { action: "invite-slots", stepId, ttlHours: 72 });
  ok(rInvite.status === 200 && typeof rInvite.json?.link === "string", "invite-slots → 200 { link }", `HTTP ${rInvite.status}`);
  const link = rInvite.json?.link as string;
  const token = link ? new URL(link).pathname.split("/")[2] ?? "" : "";
  const linkSlug = link ? new URL(link).searchParams.get("t") ?? "" : "";
  ok(token.length === 64 && /^[a-f0-9]{64}$/.test(token), "token 64-hex terparse dari link", token.slice(0, 12) + "…");
  ok(linkSlug === TENANT_SLUG, "link memuat slug tenant dari registry", linkSlug);
  const stepInvited = await db.candidateSelectionStep.findUnique({ where: { id: stepId } });
  ok(!!stepInvited?.inviteTokenHash, "step.inviteTokenHash terisi (hash SHA-256 via prisma)", (stepInvited?.inviteTokenHash ?? "").slice(0, 12) + "…");

  // EmailLog invite (await path — deterministik)
  const inviteLog = await db.emailLog.count({ where: { event: "recruitment.interview.invite", createdAt: { gte: startedAt } } });
  ok(inviteLog >= 1, "EmailLog event recruitment.interview.invite (await path)", `${inviteLog} baris`);

  // ================= (4) PUBLIC GET =================
  console.log("\n[(4)] PUBLIC GET — slot via token; token acak 404; tanpa PII");
  const g1 = await fetch(`${BASE}${PUBLIC_API}?token=${token}&t=${TENANT_SLUG}`).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  ok(g1.status === 200 && g1.j?.ok === true, "GET ?token=&t= → 200 {ok:true}", `HTTP ${g1.status}`);
  ok(g1.j?.slots?.length === 3, "GET memuat 3 slot", `${g1.j?.slots?.length} slot`);
  ok(Array.isArray(g1.j?.slots) && g1.j.slots.every((s: any) => s.status === "Open"), "semua slot berstatus Open");
  const payloadStr = JSON.stringify(g1.j ?? {});
  ok(!payloadStr.includes("evaluator") && !payloadStr.includes(target!.fullName), "payload TANPA nama evaluator / PII kandidat");
  ok(typeof g1.j?.position === "string" && typeof g1.j?.tahap === "string", "position + tahap tersedia", `${g1.j?.position} · ${g1.j?.tahap}`);

  const gBad = await fetch(`${BASE}${PUBLIC_API}?token=${"ab".repeat(32)}&t=${TENANT_SLUG}`);
  ok(gBad.status === 404, "token acak → 404 netral {error:notfound}", `HTTP ${gBad.status}`);

  const slotRows = await db.interviewSlot.findMany({ where: { selectionStepId: stepId }, orderBy: { startAt: "asc" } });
  ok(slotRows.length === 3, "3 baris InterviewSlot di db", `${slotRows.length}`);

  // ================= (5) PUBLIC POST BOOK =================
  console.log("\n[(5)] PUBLIC POST — book slot ke-2 → terkunci; step terjadwal; EmailLog + .ics");
  const slot2 = slotRows[1]!;
  const p1 = await fetch(`${BASE}${PUBLIC_API}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, slotId: slot2.id, t: TENANT_SLUG }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  ok(p1.status === 200 && p1.j?.ok === true, "POST book slot ke-2 → 200 {ok, startAt}", `HTTP ${p1.status}`);
  ok(p1.j?.startAt === slot2.startAt.toISOString(), "respons startAt == slot2.startAt", p1.j?.startAt);

  const afterBook = await db.interviewSlot.findMany({ where: { selectionStepId: stepId } });
  const byId = new Map(afterBook.map((s) => [s.id, s]));
  ok(byId.get(slot2.id)?.status === "Booked", "slot2 → Booked", byId.get(slot2.id)?.status);
  const others = afterBook.filter((s) => s.id !== slot2.id);
  ok(others.length === 2 && others.every((s) => s.status === "Closed"), "slot1 + slot3 → Closed (sisa ditutup)");
  ok(!!byId.get(slot2.id)?.bookedAt, "slot2.bookedAt terisi");

  const stepBooked = await db.candidateSelectionStep.findUnique({ where: { id: stepId } });
  ok(stepBooked?.planDate?.toISOString() === slot2.startAt.toISOString(), "step.planDate == slot2.startAt", stepBooked?.planDate?.toISOString() ?? "—");
  const expectDue = slaDays ? new Date(slot2.startAt.getTime() + (slaDays as number) * 86_400_000) : null;
  ok(
    expectDue ? stepBooked?.dueDate?.toISOString() === expectDue.toISOString() : stepBooked?.dueDate == null,
    `step.dueDate recompute (plan + SLA ${slaDays ?? 0}h)`,
    stepBooked?.dueDate?.toISOString() ?? "null",
  );

  const bookedLog = await db.emailLog.count({ where: { event: "recruitment.interview.booked", createdAt: { gte: startedAt } } });
  ok(bookedLog >= 1, "EmailLog event recruitment.interview.booked (await path + lampiran .ics)", `${bookedLog} baris`);

  // .ics — parse output buildInterviewIcs (murni, tanpa DB)
  const ics = buildInterviewIcs({
    startAt: slot2.startAt, durationMin: slot2.durationMin,
    summary: `Wawancara ${stageName} — uji; c, o\\m`,
    description: "Baris 1\nBaris 2",
    location: "https://meet.example.com/abc",
  });
  ok(ics.startsWith("BEGIN:VCALENDAR") && ics.endsWith("END:VCALENDAR"), ".ics dibuka/ditutup VCALENDAR");
  ok(ics.includes("\r\n") && !/(?<!\r)\n/.test(ics), ".ics memakai CRLF (RFC 5545)");
  const dtstart = ics.split("\r\n").find((l) => l.startsWith("DTSTART:")) ?? "";
  ok(dtstart === `DTSTART:${icsUtcBasic(slot2.startAt)}`, "DTSTART UTC sesuai slot2", dtstart);
  const dtend = ics.split("\r\n").find((l) => l.startsWith("DTEND:")) ?? "";
  ok(dtend === `DTEND:${icsUtcBasic(new Date(slot2.startAt.getTime() + slot2.durationMin * 60_000))}`, "DTEND = start + durasi", dtend);
  ok(ics.includes("PRODID:-//RekanKerja//ID") && ics.includes("VERSION:2.0"), "VERSION 2.0 + PRODID ada");
  ok(ics.includes("LOCATION:https://meet.example.com/abc"), "LOCATION ikut saat diisi");
  const sumLine = ics.split("\r\n").find((l) => l.startsWith("SUMMARY:")) ?? "";
  ok(sumLine.includes("\\;") && sumLine.includes("\\,"), "SUMMARY escape ; dan , (RFC 5545)", sumLine.slice(0, 60));
  const descLine = ics.split("\r\n").find((l) => l.startsWith("DESCRIPTION:")) ?? "";
  ok(descLine.includes("\\n"), "DESCRIPTION newline di-escape \\n");

  // ================= (6) DOUBLE-BOOK → 409 =================
  console.log("\n[(6)] DOUBLE-BOOK — slot2 (Booked) + slot1 (Closed) → 409");
  const p2 = await fetch(`${BASE}${PUBLIC_API}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, slotId: slot2.id, t: TENANT_SLUG }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  ok(p2.status === 409 && p2.j?.error === "taken", "book ulang slot2 (Booked) → 409 {error:taken}", `HTTP ${p2.status}`);
  const p3 = await fetch(`${BASE}${PUBLIC_API}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, slotId: slotRows[0]!.id, t: TENANT_SLUG }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  ok(p3.status === 409, "book slot1 (Closed) → 409", `HTTP ${p3.status}`);

  // ================= (7) BACKDATE EXPIRED → 410 =================
  console.log("\n[(7)] EXPIRED — backdate inviteTokenExpAt → POST 410");
  await db.candidateSelectionStep.update({
    where: { id: stepId },
    data: { inviteTokenExpAt: new Date(Date.now() - 60_000) },
  });
  const p4 = await fetch(`${BASE}${PUBLIC_API}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, slotId: slotRows[2]!.id, t: TENANT_SLUG }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  ok(p4.status === 410 && p4.j?.error === "expired", "token kedaluwarsa → 410 {error:expired}", `HTTP ${p4.status}`);
  const gExp = await fetch(`${BASE}${PUBLIC_API}?token=${token}&t=${TENANT_SLUG}`);
  ok(gExp.status === 410, "GET token kedaluwarsa → 410 netral", `HTTP ${gExp.status}`);

  // ================= (8) SCORECARD PANEL + DIVERGENCE =================
  console.log("\n[(8)] SCORECARD — 2 evaluator ekstrem (5 vs 2) → divergence > 2");
  const tpl = await db.scorecardTemplate.findFirst({
    where: { active: true, selectionProcessId: null },
    include: { competencies: { orderBy: { orderNo: "asc" } } },
  }) ?? await db.scorecardTemplate.findFirst({ where: { active: true }, include: { competencies: { orderBy: { orderNo: "asc" } } } });
  ok(!!tpl && tpl.competencies.length > 0, "template rubrik aktif tersedia", tpl?.name ?? "—");
  if (tpl) {
    const [evA, evB] = [evaluators[1]!, evaluators[2]!];
    const mk = (score: number) => tpl.competencies.map((c) => ({ competencyId: c.id, score, comment: null }));
    const rA = await hr.api("POST", SELECTION_API, {
      action: "scorecard-save", selectionStepId: stepId, evaluatorId: evA.id, templateId: tpl.id,
      items: mk(5), recommendation: "StrongHire", overallComment: "Sangat sesuai — e2e P2.3", submit: true,
    });
    ok(rA.status === 200, `scorecard ${evA.fullName} (skor 5) → 200`, `HTTP ${rA.status}${rA.json?.error ? ` — ${rA.json.error}` : ""}`);
    const rB = await hr.api("POST", SELECTION_API, {
      action: "scorecard-save", selectionStepId: stepId, evaluatorId: evB.id, templateId: tpl.id,
      items: mk(2), recommendation: "NoHire", overallComment: "Kurang sesuai — e2e P2.3", submit: true,
    });
    ok(rB.status === 200, `scorecard ${evB.fullName} (skor 2) → 200`, `HTTP ${rB.status}${rB.json?.error ? ` — ${rB.json.error}` : ""}`);

    const gPanel = await hr.api("GET", `${SELECTION_API}?stepId=${stepId}&scorecards=1`);
    ok(gPanel.status === 200, "GET ?stepId=&scorecards=1 → 200", `HTTP ${gPanel.status}`);
    const panel = gPanel.json?.panel;
    const submitted = (panel?.scorecards ?? []).filter((s: any) => s.submittedAt != null);
    ok(submitted.length >= 2, "panel memuat ≥2 scorecard submitted", `${submitted.length} terkirim`);
    ok(panel?.divergence === true, "divergence flag true (gap 3 > 2)", `gap=${panel?.divergenceGap}`);
    ok(Array.isArray(gPanel.json?.slots), "respons scorecards kini memuat field slots (backward-compat tambahan)", `${gPanel.json?.slots?.length} slot`);
  }

  // ================= (9) GUARD =================
  console.log("\n[(9)] GUARD — ESS tanpa op:schedule → 403");
  const gEss = await ess.api("POST", SELECTION_API, { action: "slots-save", stepId, slots: [{ startAt: s1, durationMin: 60 }] });
  ok(gEss.status === 403, "ESS POST slots-save → 403 (menu-guard)", `HTTP ${gEss.status}`);
  const gEss2 = await ess.api("POST", SELECTION_API, { action: "invite-slots", stepId });
  ok(gEss2.status === 403, "ESS POST invite-slots → 403", `HTTP ${gEss2.status}`);

  // ================= (10) CLEANUP =================
  console.log("\n[(10)] CLEANUP — data domain dihapus, step di-restore (EmailLog/ActivityLog DIPERTAHANKAN)");
  await db.candidateStepEvaluator.deleteMany({ where: { selectionStepId: stepId } });
  await db.interviewSlot.deleteMany({ where: { selectionStepId: stepId } });
  await db.candidateScorecard.deleteMany({ where: { selectionStepId: stepId, evaluatorId: { in: evaluators.map((e) => e.id) }, createdAt: { gte: startedAt } } });
  await db.notification.deleteMany({ where: { title: { contains: "Jadwal seleksi baru" }, createdAt: { gte: startedAt } } }).catch(() => {});
  await db.notification.deleteMany({ where: { title: { contains: "Jadwal wawancara terkunci" }, createdAt: { gte: startedAt } } }).catch(() => {});

  await db.candidateSelectionStep.update({
    where: { id: stepId },
    data: {
      planDate: stepBefore.planDate,
      dueDate: stepBefore.dueDate,
      performedById: stepBefore.performedById,
      meetingUrl: stepBefore.meetingUrl,
      status: stepBefore.status,
      acknowledgedAt: stepBefore.acknowledgedAt,
      inviteTokenHash: null,
      inviteTokenExpAt: null,
    },
  });

  const leftPanel = await db.candidateStepEvaluator.count({ where: { selectionStepId: stepId } });
  const leftSlots = await db.interviewSlot.count({ where: { selectionStepId: stepId } });
  const stepRestored = await db.candidateSelectionStep.findUnique({ where: { id: stepId } });
  ok(leftPanel === 0 && leftSlots === 0, "panel evaluator + slot bersih (0 baris)", `panel=${leftPanel} slot=${leftSlots}`);
  ok(
    (stepRestored?.planDate?.getTime() ?? null) === (stepBefore.planDate?.getTime() ?? null)
      && (stepRestored?.dueDate?.getTime() ?? null) === (stepBefore.dueDate?.getTime() ?? null)
      && stepRestored?.performedById === stepBefore.performedById
      && stepRestored?.status === stepBefore.status
      && stepRestored?.inviteTokenHash == null,
    "field step kembali ke pra-uji (plan/due/performer/status/token)",
  );
  const logsKept = await db.emailLog.count({ where: { event: { in: ["recruitment.interview.invite", "recruitment.interview.booked"] }, createdAt: { gte: startedAt } } });
  ok(logsKept >= 2, "EmailLog uji DIPERTAHANKAN (audit trail — pola B8)", `${logsKept} baris`);
  const actKept = await db.activityLog.count({ where: { entity: { in: ["InterviewSlot", "CandidateSelectionStep"] }, createdAt: { gte: startedAt } } });
  ok(actKept >= 4, "ActivityLog mutasi uji DIPERTAHANKAN", `${actKept} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
