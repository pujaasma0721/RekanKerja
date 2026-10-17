// Uji E2E P2.4 (Offer versioning + self-service kandidat — DEVELOPMENT-PLAN-
// BENCHMARK.md §2 D-BM19 + §4 P2.4, Recruitment §4.5 gap-6/7) — di atas data
// demo MII (fixture: kandidat Passed pada PR Approved TANPA offer existing —
// mis. Budi Santoso PR-2026-0003; struktur approval AS-OFF-STD 1 jenjang
// HR_ADMIN aktif → jalur PendingApproval → approve → performSend):
//   (0) SETUP: login HR owner (hrd@mii.co.id); pilih kandidat target.
//   (1) CREATE offer (gaji 5.000.000, mulai/berlaku H+14/H+30) → versi 1
//       label "Created"; payloadJson gaji = string TERENKRIPSI (enc:…).
//   (2) SEND → PendingApproval (struktur aktif) → APPROVE → performSend:
//       status Sent + selfServiceLink berisi /offer/<token> + tokenHash di DB
//       + EmailLog "recruitment.offer.selfservice" (await path) + versi 2 "Sent".
//   (3) GET ?offerId → versionDiffs (v2 diff vs v1; salaryDiff.changed
//       dihitung; angka keluar bila vault terbuka) + selfServiceLink hidup.
//   (4) COUNTER (gaji 6.000.000 + catatan) → status Draft + versi 3 "Counter"
//       + diff v3: salaryDiff.changed=true.
//   (5) SEND ulang → approve → versi 4 "Sent" + token BARU (link berubah).
//   (6) PUBLIC GET ?token → ringkasan TANPA nominal gaji; token acak → 404.
//   (7) RACE double-click: 2 POST accept paralel ke API publik → TEPAT SATU
//       200 + satu 409; status Accepted; versi SelfService; Notification
//       officer (link recruitment:offers) + ActivityLog "putusan mandiri".
//   (8) EXPIRED: backdate tokenExpAt → POST decline → 410.
// CLEANUP: hapus offer uji (cascade versi) — EmailLog/ActivityLog/Notification
//       DIPERTAHANKAN (pola B8).
// Jalankan: bun scripts/e2e-p24-offer.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const OFFERS_API = "/api/rekankerja/recruitment/offers";
const PUBLIC_API = "/api/public/recruitment/offer-respond";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

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

function iso(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const t0 = new Date();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + fixture kandidat (Passed, PR Approved, tanpa offer)");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  const cands = await db.jobCandidate.findMany({
    where: { status: { in: ["Passed", "InProcess"] } },
    include: { pr: { select: { id: true, prNo: true, status: true } } },
    orderBy: { nominatedAt: "desc" }, take: 40,
  });
  const target = await (async () => {
    for (const c of cands) {
      if (c.pr.status !== "Approved") continue;
      const total = await db.candidateOffer.count({ where: { candidateId: c.id } });
      if (total === 0) return c;
    }
    for (const c of cands) {
      if (c.pr.status !== "Approved") continue;
      const closed = await db.candidateOffer.count({ where: { candidateId: c.id, status: { in: ["Accepted", "Declined", "Expired"] } } });
      const open = await db.candidateOffer.count({ where: { candidateId: c.id, status: { in: ["Draft", "PendingApproval", "Sent", "Viewed"] } } });
      if (open === 0 && closed > 0) return c;
    }
    return null;
  })();
  ok(!!target, "kandidat target ditemukan (Passed/InProcess + PR Approved + tanpa offer aktif)", target ? `${target.fullName} · ${target.pr.prNo}` : "—");
  if (!target) {
    console.log(`\nHASIL: ${pass}/${pass + fail} — fixture tidak tersedia, hentikan.`);
    process.exit(1);
  }
  // PR demo TANPA recruitmentOfficer → set sementara (employee ber-AppUser utk
  // jalur notifikasi officer terukur; direstore di cleanup).
  const hrdUser = await db.appUser.findFirst({ where: { email: HR_EMAIL }, select: { employeeId: true } });
  const officerEmpId = hrdUser?.employeeId ?? null;
  ok(!!officerEmpId, "employee officer sementara (hrd) teresolve");
  await db.personnelRequisition.update({ where: { id: target.pr.id }, data: { recruitmentOfficerId: officerEmpId } });
  const officerSet = await db.personnelRequisition.findUnique({ where: { id: target.pr.id }, select: { recruitmentOfficerId: true } });
  ok(officerSet?.recruitmentOfficerId === officerEmpId, "recruitmentOfficer fixture PR di-set sementara");

  // ================= (1) CREATE → versi 1 =================
  console.log("\n[(1)] CREATE — offer baru → versi 1 \"Created\" + gaji terenkripsi di snapshot");
  const c1 = await hr.api("POST", OFFERS_API, {
    action: "create",
    prId: target.pr.id, candidateId: target.id,
    salary: 5_000_000, startDate: iso(14), expiryDate: iso(30), note: "e2e-p24 offer uji",
  });
  ok(c1.status === 201, "create offer → 201", `HTTP ${c1.status}`);
  const offerId: string | undefined = c1.json?.id;
  const offerNo: string | undefined = c1.json?.offerNo;
  ok(!!offerId && !!offerNo, "respons memuat id + offerNo", `${offerNo ?? "?"}`);
  const v1 = await db.candidateOfferVersion.findFirst({ where: { offerId } });
  ok(v1?.versionNo === 1 && v1?.label === "Created", "versi 1 label Created tersimpan", `v${v1?.versionNo} ${v1?.label}`);
  const p1 = v1 ? JSON.parse(v1.payloadJson) : {};
  ok(typeof p1.salary === "string" && String(p1.salary).startsWith("enc:"), "payloadJson gaji = string TERENKRIPSI (enc:…)", String(p1.salary ?? "").slice(0, 16));
  ok(p1.status === "Draft", "snapshot status = Draft", String(p1.status));

  // ================= (2) SEND (via approval) → versi 2 Sent + token =================
  console.log("\n[(2)] SEND — PendingApproval (AS-OFF-STD) → approve → Sent + tautan self-service");
  const s1 = await hr.api("POST", OFFERS_API, { action: "send", id: offerId });
  ok(s1.status === 200 && s1.json?.status === "PendingApproval", "send → PendingApproval (struktur aktif)", `HTTP ${s1.status} ${s1.json?.status}`);
  const a1 = await hr.api("POST", OFFERS_API, { action: "approve", id: offerId });
  ok(a1.status === 200 && a1.json?.status === "Sent", "approve final → performSend → Sent", `HTTP ${a1.status} ${a1.json?.status}`);
  const link1: string | undefined = a1.json?.selfServiceLink;
  ok(!!link1 && link1.includes("/offer/"), "selfServiceLink dikembalikan (berisi /offer/<token>)", (link1 ?? "?").slice(0, 64));
  const afterSend = await db.candidateOffer.findUnique({ where: { id: offerId }, select: { selfServiceTokenHash: true, selfServiceTokenExpAt: true, sentAt: true, status: true } });
  ok(!!afterSend?.selfServiceTokenHash, "selfServiceTokenHash terisi di DB (hash one-way)");
  ok(!!afterSend?.sentAt && afterSend.status === "Sent", "sentAt + status Sent");
  const v2 = await db.candidateOfferVersion.findFirst({ where: { offerId, versionNo: 2 } });
  ok(v2?.label === "Sent", "versi 2 label Sent");
  const emCount0 = await db.emailLog.count({ where: { event: "recruitment.offer.selfservice", createdAt: { gte: t0 } } });
  ok(emCount0 >= 1, "EmailLog recruitment.offer.selfservice terkirim (await path)", `${emCount0} baris`);
  const actSent = await db.activityLog.count({ where: { entity: "CandidateOffer", entityId: offerNo, createdAt: { gte: t0 } } });
  ok(actSent >= 2, "ActivityLog offer tercatat (submit/approve/send)", `${actSent} baris`);

  // ================= (3) GET detail → versionDiffs + link =================
  console.log("\n[(3)] GET ?offerId — versionDiffs (vault) + selfServiceLink hidup");
  const g1 = await hr.api("GET", `${OFFERS_API}?offerId=${offerId}`);
  ok(g1.status === 200, "GET detail offer 200");
  const vd: any[] | undefined = g1.json?.row?.versionDiffs;
  ok(Array.isArray(vd) && vd.length === 2, "versionDiffs memuat 2 versi", `${vd?.length ?? 0}`);
  const v2diff = vd?.find((v) => v.versionNo === 2)?.diff;
  ok(!!v2diff, "versi 2 membawa diff (vs v1)");
  ok(v2diff?.salaryDiff?.changed === false, "diff v2: gaji TIDAK berubah saat send (changed=false)");
  ok(!!g1.json?.row?.selfServiceLink && g1.json.row.selfServiceLink === link1, "selfServiceLink di GET == link send (token hidup)");

  // ================= (4) COUNTER → versi 3 + status Draft =================
  console.log("\n[(4)] COUNTER — gaji 6.000.000 → versi 3 + kembali Draft");
  const k1 = await hr.api("POST", OFFERS_API, {
    action: "counter", id: offerId,
    edits: { salary: 6_000_000, note: "e2e-p24 counter kandidat nego" },
  });
  ok(k1.status === 200, "counter offer → 200", `HTTP ${k1.status}`);
  const afterCounter = await db.candidateOffer.findUnique({ where: { id: offerId }, select: { status: true } });
  ok(afterCounter?.status === "Draft", "status kembali Draft utk edit ulang", String(afterCounter?.status));
  const v3 = await db.candidateOfferVersion.findFirst({ where: { offerId, versionNo: 3 } });
  ok(v3?.label === "Counter", "versi 3 label Counter");
  const g2 = await hr.api("GET", `${OFFERS_API}?offerId=${offerId}`);
  const v3diff = (g2.json?.row?.versionDiffs ?? []).find((v: any) => v.versionNo === 3)?.diff;
  ok(v3diff?.salaryDiff?.changed === true, "diff v3: salaryDiff.changed=true (5jt → 6jt — metadata vault)", JSON.stringify(v3diff?.salaryDiff ?? null).slice(0, 80));
  ok((v3diff?.fields ?? []).some((f: any) => f.field === "note"), "diff v3 memuat field non-uang (note)");
  const kBlocked = await hr.api("POST", OFFERS_API, { action: "counter", id: offerId, edits: { salary: 7_000_000 } });
  ok(kBlocked.status >= 400, "counter pada Draft → ditolak (hanya Sent/Viewed)", `HTTP ${kBlocked.status}`);

  // ================= (5) SEND ulang → versi 4 + token BARU =================
  console.log("\n[(5)] SEND ulang — versi 4 Sent + tautan token baru menimpa yang lama");
  const s2 = await hr.api("POST", OFFERS_API, { action: "send", id: offerId });
  ok(s2.status === 200 && s2.json?.status === "PendingApproval", "send ulang → PendingApproval", `HTTP ${s2.status}`);
  const a2 = await hr.api("POST", OFFERS_API, { action: "approve", id: offerId });
  ok(a2.status === 200 && a2.json?.status === "Sent", "approve → Sent", `HTTP ${a2.status}`);
  const link2: string | undefined = a2.json?.selfServiceLink;
  ok(!!link2 && link2 !== link1, "token BARU diterbitkan (link berubah — token lama terinvalidate)", (link2 ?? "?").slice(-20));
  const v4 = await db.candidateOfferVersion.findFirst({ where: { offerId, versionNo: 4 } });
  ok(v4?.label === "Sent", "versi 4 label Sent");
  const tok = (link2 ?? "").split("/offer/")[1]?.split("?")[0] ?? "";
  ok(/^[a-f0-9]{16,128}$/i.test(tok), "format token hex valid", tok.slice(0, 16) + "…");

  // ================= (6) PUBLIC GET — ringkasan tanpa gaji =================
  console.log("\n[(6)] PUBLIC GET ?token — ringkasan TANPA nominal (kebijakan halaman status)");
  const pg = await fetch(`${BASE}${PUBLIC_API}?token=${tok}&t=pt-mitra-industri-internasional`);
  const pgText = await pg.text();
  ok(pg.status === 200, "GET publik 200", `HTTP ${pg.status}`);
  ok(!pgText.includes("5000000") && !pgText.includes("6000000") && !pgText.includes("5.000.000") && !pgText.includes("6.000.000"),
    "respons publik TIDAK memuat nominal gaji");
  let pgJson: any = {};
  try { pgJson = JSON.parse(pgText); } catch { /* keep */ }
  ok(pgJson?.ok === true && !!pgJson?.offerNo, "ringkasan memuat ok + offerNo", pgJson?.offerNo ?? "?");
  const bad = await fetch(`${BASE}${PUBLIC_API}?token=${"0".repeat(64)}&t=pt-mitra-industri-internasional`);
  ok(bad.status === 404, "token acak → 404 netral", `HTTP ${bad.status}`);

  // ================= (7) RACE double-click + integrasi HR =================
  console.log("\n[(7)] RACE — 2 POST accept paralel → tepat satu 200 + satu 409");
  const [r1, r2] = await Promise.all([
    fetch(`${BASE}${PUBLIC_API}?t=pt-mitra-industri-internasional`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tok, action: "accept", note: "e2e-p24 race A" }) }),
    fetch(`${BASE}${PUBLIC_API}?t=pt-mitra-industri-internasional`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tok, action: "accept", note: "e2e-p24 race B" }) }),
  ]);
  const codes = [r1.status, r2.status].sort();
  ok(codes[0] === 200 && codes[1] === 409, "tepat SATU 200 + SATU 409 (race-guard kondisional)", `HTTP ${codes.join(" + ")}`);
  const afterAccept = await db.candidateOffer.findUnique({ where: { id: offerId }, select: { status: true, respondedAt: true } });
  ok(afterAccept?.status === "Accepted" && !!afterAccept?.respondedAt, "status final Accepted + respondedAt terisi", String(afterAccept?.status));
  const vLast = await db.candidateOfferVersion.findFirst({ where: { offerId }, orderBy: { versionNo: "desc" } });
  ok((vLast?.versionNo ?? 0) >= 5, `versi putusan ter-snapshot (v${vLast?.versionNo} label ${vLast?.label})`);
  const officerNotif = await waitFor(async () => {
    const n = await db.notification.count({ where: { link: "recruitment:offers", createdAt: { gte: t0 } } });
    return n >= 1;
  });
  ok(officerNotif, "Notification officer (HR dashboard) ter-update — link recruitment:offers");
  const actPortal = await db.activityLog.count({ where: { entity: "CandidateOffer", entityId: offerNo, detail: { contains: "putusan mandiri via portal" } } });
  ok(actPortal >= 1, "ActivityLog \"putusan mandiri via portal\" (audit self-service)", `${actPortal} baris`);

  // ================= (8) EXPIRED — backdate exp → 410 =================
  console.log("\n[(8)] EXPIRED — token kedaluwarsa → 410");
  await db.candidateOffer.update({ where: { id: offerId }, data: { selfServiceTokenExpAt: new Date(Date.now() - 60_000) } });
  const pe = await fetch(`${BASE}${PUBLIC_API}?t=pt-mitra-industri-internasional`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tok, action: "decline" }) });
  ok(pe.status === 410, "POST token kedaluwarsa → 410", `HTTP ${pe.status}`);
  const pge = await fetch(`${BASE}${PUBLIC_API}?token=${tok}&t=pt-mitra-industri-internasional`);
  ok(pge.status === 410, "GET token kedaluwarsa → 410 netral", `HTTP ${pge.status}`);

  // ================= (9) CLEANUP =================
  console.log("\n[(9)] CLEANUP — hapus offer uji (cascade versi); audit trail dipertahankan");
  await db.personnelRequisition.update({ where: { id: target.pr.id }, data: { recruitmentOfficerId: null } }).catch(() => { /* fixture PR */ });
  const emKeep = await db.emailLog.count({ where: { event: "recruitment.offer.selfservice", createdAt: { gte: t0 } } });
  await db.candidateOffer.delete({ where: { id: offerId } }).catch(() => { /* appointment tidak ada */ });
  const offersLeft = await db.candidateOffer.count({ where: { id: offerId } });
  const versionsLeft = await db.candidateOfferVersion.count({ where: { offerId } });
  ok(offersLeft === 0 && versionsLeft === 0, "offer + versi uji bersih (cascade)", `offer=${offersLeft} versi=${versionsLeft}`);
  const emKeep2 = await db.emailLog.count({ where: { event: "recruitment.offer.selfservice", createdAt: { gte: t0 } } });
  ok(emKeep2 === emKeep, "EmailLog DIPERTAHANKAN (audit trail — pola B8)", `${emKeep2} baris`);
  const actKeep = await db.activityLog.count({ where: { entity: "CandidateOffer", entityId: offerNo } });
  ok(actKeep >= 2, "ActivityLog DIPERTAHANKAN", `${actKeep} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "ADA YANG GAGAL ✗"} — mulai ${t0.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
