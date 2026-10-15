// Uji E2E API B6 (Rekrutmen quick wins: WA wiring + meetingUrl) per
// DEVELOPMENT-PLAN-BACKLOG.md §4 B6 — di atas data demo MII (login owner
// hrd@mii.co.id; ESS yusuf@mii.co.id):
//   (1) TEMPLATE WA SEED: GET /api/rekankerja/wa-templates → memuat ≥9 baris
//       rekrutmen event-keyed active=true + TIDAK ada recruitment.esign.otp
//       (OTP tidak lewat WA — risiko §5) + self-heal: hapus 1 baris → GET →
//       baris muncul kembali (insert-if-missing, edit admin tak ditimpa);
//       verifikasi 3 tenant punya baris WaTemplate rekrutmen (query db).
//   (2) SENDWA LOG: jadwalkan tahap seleksi via API dgn meetingUrl
//       "https://meet.example.com/e2e-b6" (kandidat ber-phone; config WA
//       aktif TANPA token → provider belum siap) → WaLog row BARU event
//       recruitment.selection.scheduled, toPhone = phone kandidat
//       (dinormalisasi 62…), status Skipped, body ter-render MEMUAT link
//       meeting + ≥1 placeholder lain.
//   (3) MEETING URL: meetingUrl tersimpan di db + muncul di respons detail
//       step (GET ?candidateId=); update tanpa meetingUrl → null; URL tidak
//       valid "bukan-url" → 400.
//   (4) GUARD: ESS yusuf POST schedule → 403 (menu guard recruitment:
//       selection op:schedule — meetingUrl hanya diubah HR).
//   (5) OFFER WA: kirim offer via API (create → send → approve final) ke
//       kandidat ber-phone → WaLog row recruitment.offer.sent Skipped +
//       body ter-render (assert ≥1 placeholder terisi: offerNo).
//   (6) CLEANUP: restore step (plan/due/status/ack/meetingUrl), hapus offer
//       uji + surat + approval chain, restore WaConfig (baris uji dihapus),
//       phone kandidat tidak diubah (memang terisi). WaLog uji historis —
//       aman dibiarkan.
// Jalankan: bun scripts/e2e-b6-wa-meeting.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const ESS_YUSUF = "yusuf@mii.co.id";
const ESS_YUSUF_PW = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const SELECTION_API = "/api/rekankerja/recruitment/selection";
const OFFERS_API = "/api/rekankerja/recruitment/offers";
const MEETING_URL = "https://meet.example.com/e2e-b6";

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
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
}

/** Normalisasi nomor HP Indonesia → 62… (mirror wa-service.normalizePhone). */
function normalizePhone(raw: string | null | undefined): string {
  let p = (raw ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!p) return "";
  if (p.startsWith("0")) p = `62${p.slice(1)}`;
  else if (p.startsWith("8")) p = `62${p}`;
  return p;
}

/** Tunggu hingga predicate mengembalikan nilai non-null (poll 250ms, maks ms). */
async function waitFor<T>(ms: number, pred: () => Promise<T | null | undefined>): Promise<T | null> {
  const until = Date.now() + ms;
  let last: T | null = null;
  while (Date.now() < until) {
    last = (await pred()) ?? null;
    if (last != null) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await pred()) ?? null;
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const yusuf = new Sesi();
  const schemas = ["tenant_cahaya_digital_nusantara", "tenant_pt_mitra_industri_internasional", "tenant_sentra_logistik_prima"];

  // ================= (1) TEMPLATE WA SEED =================
  console.log("\n[(1)] TEMPLATE WA — seed rekrutmen + tanpa esign.otp + self-heal + 3 tenant");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const tpl = await owner.api("GET", "/api/rekankerja/wa-templates");
  const rows = (tpl.json?.templates ?? []) as { event: string; active: boolean; body: string }[];
  const recRows = rows.filter((r) => r.event.startsWith("recruitment."));
  ok(tpl.status === 200, "GET /api/rekankerja/wa-templates → 200", `${rows.length} template`);
  ok(recRows.filter((r) => r.active).length >= 9, `≥9 template rekrutmen active=true`, `${recRows.filter((r) => r.active).length} baris`);
  ok(!rows.some((r) => r.event === "recruitment.esign.otp"), "TIDAK ada template recruitment.esign.otp (OTP tidak lewat WA)");
  const schedTpl = recRows.find((r) => r.event === "recruitment.selection.scheduled");
  ok(!!schedTpl && schedTpl.body.includes("{{linkMeeting}}"), "template selection.scheduled memuat placeholder {{linkMeeting}}");
  for (const ev of [
    "recruitment.pr.submitted", "recruitment.pr.approved", "recruitment.pr.rejected",
    "recruitment.selection.scheduled", "recruitment.selection.reminder",
    "recruitment.offer.sent", "recruitment.offer.reminder", "recruitment.appointment.hired",
    "recruitment.application.received",
  ]) {
    ok(recRows.some((r) => r.event === ev && r.active), `template ${ev} ada & aktif`);
  }

  // self-heal: hapus satu baris → GET → muncul lagi (insert-if-missing)
  {
    const evSelfHeal = "recruitment.application.received";
    const before = await db.waTemplate.findUnique({ where: { event: evSelfHeal } });
    ok(!!before, `baris ${evSelfHeal} ada pra-self-heal`);
    await db.waTemplate.delete({ where: { event: evSelfHeal } });
    const reget = await owner.api("GET", "/api/rekankerja/wa-templates");
    const healed = ((reget.json?.templates ?? []) as { event: string; body: string }[]).find((r) => r.event === evSelfHeal);
    ok(!!healed && healed.body === before?.body, "self-heal aktif — baris terhapus muncul kembali via GET (body identik default)");
  }

  // paritas 3 tenant
  for (const s of schemas) {
    const tdb = getTenantClient(s);
    const n = await tdb.waTemplate.count({ where: { event: { startsWith: "recruitment." }, active: true } });
    ok(n >= 9, `tenant ${s}: ≥9 baris WaTemplate rekrutmen aktif`, `${n} baris`);
    await tdb.$disconnect?.();
  }

  // ================= (2) SENDWA LOG — jadwalkan tahap + WaLog =================
  console.log("\n[(2)] SENDWA LOG — schedule dgn meetingUrl → WaLog Skipped + body ter-render");
  // kandidat InProcess/Nominated ber-applicant ber-phone + step Planned (bukan current)
  const cand = await db.jobCandidate.findFirst({
    where: {
      status: { in: ["InProcess", "Nominated"] },
      applicantId: { not: null },
      pr: { status: "Approved" },
      selectionSteps: { some: { status: "Planned" } },
    },
    orderBy: { createdAt: "asc" },
    include: { selectionSteps: { where: { status: "Planned" }, orderBy: { seqNo: "asc" }, take: 3 } },
  });
  ok(!!cand, "kandidat uji ditemukan (InProcess/Nominated + applicant + step Planned)", cand ? `${cand.id}` : "-");
  if (!cand) { finish(); return; }

  const step = cand.selectionSteps.find((s) => s.planDate == null) ?? cand.selectionSteps[0]!;
  const tc = tenantCryptoForDb(db as never);
  const applicant = await db.applicant.findUnique({ where: { id: cand.applicantId! }, select: { phone: true } });
  let candPhonePlain = applicant?.phone ? tc.decryptText(applicant.phone) : null;
  let phoneRestored = true;
  if (!candPhonePlain) {
    // set phone sementara (restore di cleanup) — pola brief C.2
    candPhonePlain = "081234567890";
    await db.applicant.update({ where: { id: cand.applicantId! }, data: { phone: tc.encryptText(candPhonePlain)! } });
    phoneRestored = false;
    console.log("  (phone kandidat kosong — diset sementara 081234567890, restore di cleanup)");
  }
  const candPhoneNorm = normalizePhone(candPhonePlain);
  ok(!!candPhoneNorm && candPhoneNorm.startsWith("62"), "phone kandidat terdekripsi + dinormalisasi", candPhoneNorm);

  // snapshot step utk restore
  const stepBefore = await db.candidateSelectionStep.findUnique({ where: { id: step.id } });
  const proc = await db.selectionProcess.findUnique({ where: { id: step.selectionProcessId }, select: { name: true } });

  // config WA: aktif TANPA token (baris uji — restore di cleanup). updateMany
  // SEMUA baris — db demo bisa punya >1 WaConfig (pollusi data uji sesi
  // sebelumnya) dan getWaConfig server memakai findFirst tanpa orderBy →
  // baris mana pun yang terpilih harus aktif agar jalur render tercapai.
  const cfgBefore = await db.waConfig.findFirst();
  const createdConfigRow = !cfgBefore;
  const cfgActiveBefore = cfgBefore?.active ?? false;
  if (!cfgBefore) await db.waConfig.create({ data: { active: true } }); // provider Fonnte, token "" → belum siap
  else await db.waConfig.updateMany({ data: { active: true } });

  const waLogCountBefore = await db.waLog.count({ where: { event: "recruitment.selection.scheduled" } });
  // id baris PRA-panggilan — baris "BARU" = id tak ada di himpunan ini
  // (run sebelumnya meninggalkan WaLog historis dgn body serupa — brief C.2
  // "WaLog uji tak perlu dihapus", jadi kebaruan HARUS diukur per id).
  const schedIdsBefore = new Set(
    (await db.waLog.findMany({ where: { event: "recruitment.selection.scheduled" }, select: { id: true } })).map((r) => r.id),
  );
  const planIso = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16);
  const sched = await owner.api("POST", SELECTION_API, {
    action: "schedule", stepId: step.id, planDate: planIso, meetingUrl: MEETING_URL,
  });
  ok(sched.status === 200, "POST schedule (owner, dgn meetingUrl) → 200", `HTTP ${sched.status}`);

  const foundSchedWa = async () => {
    const logs = await db.waLog.findMany({
      where: { event: "recruitment.selection.scheduled", toPhone: candPhoneNorm },
      orderBy: { createdAt: "desc" }, take: 20,
    });
    return logs.find((l) => !schedIdsBefore.has(l.id) && (l.body ?? "").includes("meet.example.com/e2e-b6")) ?? null;
  };
  const schedLog = await waitFor(8000, foundSchedWa);
  ok(!!schedLog, "WaLog BARU (id baru) recruitment.selection.scheduled ke phone kandidat (≤8 dtk)");
  if (schedLog) {
    ok(schedLog.status === "Skipped", "status WaLog = Skipped (config aktif tanpa token — provider belum siap)", `error: ${schedLog.error ?? "-"}`);
    ok((schedLog.body ?? "").includes("meet.example.com/e2e-b6"), "body ter-render MEMUAT link meeting", (schedLog.body ?? "").slice(0, 80) + "…");
    ok((schedLog.body ?? "").includes(cand.fullName) || (proc?.name ? (schedLog.body ?? "").includes(proc.name) : false), "body memuat ≥1 placeholder domain lain (kandidat/tahap)");
    ok(!schedLog.body || !schedLog.body.includes("{{"), "tidak ada placeholder mentah tersisa di body");
  }
  ok((await db.waLog.count({ where: { event: "recruitment.selection.scheduled" } })) > waLogCountBefore, "jumlah WaLog event bertambah", `${waLogCountBefore} → ${await db.waLog.count({ where: { event: "recruitment.selection.scheduled" } })}`);

  // ================= (3) MEETING URL =================
  console.log("\n[(3)] MEETING URL — simpan db + detail step + clear + 400");
  {
    const inDb = await db.candidateSelectionStep.findUnique({ where: { id: step.id }, select: { meetingUrl: true } });
    ok(inDb?.meetingUrl === MEETING_URL, "db: CandidateSelectionStep.meetingUrl tersimpan", inDb?.meetingUrl ?? "-");
    const detail = await owner.api("GET", `${SELECTION_API}?candidateId=${cand.id}`);
    const stepRow = ((detail.json?.row?.steps ?? []) as { id: string; meetingUrl: string | null }[]).find((s) => s.id === step.id);
    ok(detail.status === 200 && stepRow?.meetingUrl === MEETING_URL, "respons detail kandidat memuat meetingUrl step", stepRow?.meetingUrl ?? "-");

    const clear = await owner.api("POST", SELECTION_API, {
      action: "schedule", stepId: step.id, planDate: planIso, meetingUrl: null,
    });
    const cleared = await db.candidateSelectionStep.findUnique({ where: { id: step.id }, select: { meetingUrl: true } });
    ok(clear.status === 200 && cleared?.meetingUrl === null, "update tanpa meetingUrl → null di db");

    const bad = await owner.api("POST", SELECTION_API, {
      action: "schedule", stepId: step.id, planDate: planIso, meetingUrl: "bukan-url",
    });
    const afterBad = await db.candidateSelectionStep.findUnique({ where: { id: step.id }, select: { meetingUrl: true } });
    ok(bad.status === 400, `URL tidak valid "bukan-url" → 400`, `HTTP ${bad.status} — ${(bad.json?.error ?? "").slice(0, 60)}`);
    ok(afterBad?.meetingUrl === null, "db tidak berubah saat 400");
  }

  // ================= (4) GUARD =================
  console.log("\n[(4)] GUARD — ESS tidak bisa set meetingUrl (menu guard op existing)");
  {
    const essLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
    const ess = await yusuf.api("POST", SELECTION_API, {
      action: "schedule", stepId: step.id, planDate: planIso, meetingUrl: "https://meet.example.com/ess-forbidden",
    });
    ok(essLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${essLogin.status}`);
    ok(ess.status === 403, "ESS POST schedule (set meetingUrl) → 403", `HTTP ${ess.status}`);
  }

  // ================= (5) OFFER WA =================
  console.log("\n[(5)] OFFER WA — create → send → approve → WaLog offer.sent");
  {
    const offCand = await db.jobCandidate.findFirst({
      where: {
        status: { in: ["Passed", "InProcess"] },
        applicantId: { not: null },
        pr: { status: "Approved" },
        offers: { none: { status: { in: ["Draft", "PendingApproval", "Sent", "Viewed"] } } },
      },
      orderBy: { createdAt: "asc" },
    });
    ok(!!offCand, "kandidat offerable tanpa offer aktif ditemukan", offCand ? `${offCand.id}` : "-");
    if (offCand) {
      const offApplicant = await db.applicant.findUnique({ where: { id: offCand.applicantId! }, select: { phone: true } });
      const offPhoneNorm = offApplicant?.phone ? normalizePhone(tc.decryptText(offApplicant.phone)) : "";
      ok(!!offPhoneNorm, "phone kandidat offer terbaca", offPhoneNorm);

      const created = await owner.api("POST", OFFERS_API, {
        action: "create", prId: offCand.prId, candidateId: offCand.id,
        salary: 8_500_000, currency: "IDR", salaryUnit: "Monthly",
        startDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        expiryDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        note: "E2E B6 — offer WA test",
      });
      ok(created.status === 201 && created.json?.id, "POST offers create → 201", `HTTP ${created.status} — ${created.json?.offerNo ?? ""}`);
      const offerId = String(created.json?.id ?? "");
      const offerNo = String(created.json?.offerNo ?? "");
      // id WaLog offer pra-kirim — offerNo bisa terulang antar-run (max-suffix
      // setelah offer uji dihapus), jadi kebaruan diukur per id juga di sini.
      const offerIdsBefore = new Set(
        (await db.waLog.findMany({ where: { event: "recruitment.offer.sent" }, select: { id: true } })).map((r) => r.id),
      );

      let sent = false;
      let letterNo: string | null = null;
      if (offerId) {
        const sendRes = await owner.api("POST", OFFERS_API, { action: "send", id: offerId });
        if (sendRes.json?.sent === true) { sent = true; letterNo = sendRes.json?.letterNo ?? null; }
        else {
          const appr = await owner.api("POST", OFFERS_API, { action: "approve", id: offerId });
          sent = appr.json?.sent === true;
          letterNo = appr.json?.letterNo ?? null;
          ok(appr.status === 200, "POST offers approve (jenjang HR_ADMIN final) → 200", `HTTP ${appr.status}`);
        }
        ok(sendRes.status === 200, "POST offers send → 200", `HTTP ${sendRes.status}`);
      }
      ok(sent, "offer terkirim (langsung / final approval) — performSend + surat", letterNo ?? "-");

      if (sent) {
        const foundOfferWa = async () => {
          const logs = await db.waLog.findMany({
            where: { event: "recruitment.offer.sent", toPhone: offPhoneNorm },
            orderBy: { createdAt: "desc" }, take: 20,
          });
          return logs.find((l) => !offerIdsBefore.has(l.id) && (l.body ?? "").includes(offerNo)) ?? null;
        };
        const offerLog = await waitFor(8000, foundOfferWa);
        ok(!!offerLog, "WaLog BARU (id baru) recruitment.offer.sent ke phone kandidat");
        if (offerLog) {
          ok(offerLog.status === "Skipped", "status WaLog offer = Skipped (provider belum siap)", `error: ${offerLog.error ?? "-"}`);
          ok((offerLog.body ?? "").includes(offerNo) && !(offerLog.body ?? "").includes("{{"), "body ter-render (offerNo terisi, tanpa placeholder mentah)", (offerLog.body ?? "").slice(0, 80) + "…");
        }
      }

      // ---- cleanup offer uji ----
      if (offerId) {
        await db.approvalChain.deleteMany({ where: { docType: "RecruitmentOffer", docId: offerId } });
        if (letterNo) await db.recruitmentLetter.deleteMany({ where: { letterNo } });
        await db.candidateOffer.deleteMany({ where: { id: offerId } });
        const left = await db.candidateOffer.count({ where: { id: offerId } });
        ok(left === 0, "cleanup: offer uji + surat + approval chain dihapus");
      }
    }
  }

  // ================= (6) CLEANUP =================
  console.log("\n[(6)] CLEANUP — restore step + config");
  if (stepBefore) {
    await db.candidateSelectionStep.update({
      where: { id: step.id },
      data: {
        planDate: stepBefore.planDate, dueDate: stepBefore.dueDate,
        status: stepBefore.status, acknowledgedAt: stepBefore.acknowledgedAt,
        performedById: stepBefore.performedById, meetingUrl: stepBefore.meetingUrl,
      },
    });
    const after = await db.candidateSelectionStep.findUnique({ where: { id: step.id } });
    ok(after?.planDate?.getTime() === stepBefore.planDate?.getTime() && after?.meetingUrl === stepBefore.meetingUrl,
      "step dikembalikan ke kondisi awal (plan/due/status/ack/meetingUrl)");
  }
  if (!phoneRestored) {
    await db.applicant.update({ where: { id: cand.applicantId! }, data: { phone: null } });
    ok(true, "phone kandidat sementara dikembalikan null");
  }
  if (createdConfigRow) {
    await db.waConfig.deleteMany({});
    ok((await db.waConfig.count()) === 0, "WaConfig baris uji dihapus (kembali tanpa baris = default MATI)");
  } else {
    await db.waConfig.updateMany({ data: { active: cfgActiveBefore } });
    ok(true, `WaConfig active dikembalikan ${cfgActiveBefore}`);
  }

  finish();
}

function finish() {
  console.log(`\n=== HASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
