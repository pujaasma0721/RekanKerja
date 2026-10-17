// Uji E2E API B1 (OKR Kuartalan + Board Transparan) per DEVELOPMENT-PLAN-
// BACKLOG.md §4 B1 / D-BL1…D-BL5 — di atas data demo MII (login owner
// hrd@mii.co.id; ESS yusuf@mii.co.id):
//   0. RESET idempoten: okrEnabled=false + bersihkan tabel OKR (fitur baru).
//   1. GUARD fitur-off (D-BL2): create → 409; GET board 200 + okrEnabled=false.
//   2. AKTIFKASI via settings POST {okrEnabled:true} (HR) → terbaca GET.
//   3. HR BUAT objective utk Bambang (3 KR Σ100) → Draft terlihat HR di board
//      (D-BL3) → POSTING → board ESS yusuf memuat objective Posted + 3 KR.
//   4. ESS yusuf: buat objective sendiri (Draft) → post sendiri (owner boleh,
//      D-BL3) → updateKr current → progress live NAIK (skor on-read D-BL5).
//   5. GUARD negatif: 2 KR → 400; Σbobot 90 → 400; kuartal "2026-Q5" → 400;
//      target = baseline → 400; polarity salah → 400; ESS update KR objective
//      orang lain → 403; ESS edit objective orang lain → 403; ESS aksi close
//      tidak diekspos → 400; admin GET board oleh ESS → 403 (menu-guard).
//   6. POHON ALIGN (D-BL4): objective B align ke A → board menampilkan
//      alignParentTitle; detail A menampilkan alignChildren; guard siklus
//      (C align D + D align C → 400 melingkar).
//   7. CLOSE (D-BL5, HR saja): update KR Bambang ke nilai dikenal → close →
//      closedScore tersimpan = hitung manual Σ(bobot/100 × clamp); updateKr
//      pasca-Closed → 409; post pasca-Closed → 409; ESS close → 403
//      (admin endpoint) / tidak ada (ESS).
//   8. OVERVIEW: GET reports → okrSummary muncul (quarter berjalan, posted>0).
// Jalankan: bun run scripts/e2e-b1-okr.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

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

/** Kuartal berjalan "YYYY-Qn" (lokal). */
function currentQuarter(): string {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/** Hitung ulang skor objective persis rumus server (D-BL5). */
function calcScore(krs: { polarity: string; baseline: number; target: number; current: number; weight: number }[]): number {
  const s = krs.reduce((acc, k) => {
    const span = k.target - k.baseline;
    if (!Number.isFinite(span) || span === 0) return acc;
    const raw = k.polarity === "LowerIsBetter" ? (k.baseline - k.current) / (k.baseline - k.target) : (k.current - k.baseline) / span;
    return acc + (k.weight / 100) * Math.min(1, Math.max(0, raw));
  }, 0);
  return Math.round(s * 100) / 100;
}

const Q = currentQuarter();

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const yusuf = new Sesi();

  // ================= 0. RESET idempoten =================
  console.log("\n[0] RESET — okrEnabled=false + bersihkan OKR");
  await db.okrObjective.deleteMany({});
  await db.performanceSetting.updateMany({ data: { okrEnabled: false } });

  // ================= 1. GUARD FITUR OFF (D-BL2) =================
  console.log("\n[1] GUARD FITUR OFF — D-BL2 default OFF");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const bambang = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00003" }, select: { id: true, fullName: true } });
  const yusufEmp = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00010" }, select: { id: true, fullName: true } });

  const offCreate = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Uji fitur off", ownerEmployeeId: bambang.id,
    keyResults: [
      { title: "KR satu", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 40 },
      { title: "KR dua", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 30 },
      { title: "KR tiga", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 30 },
    ],
  });
  ok(offCreate.status === 409 && /belum diaktifkan/i.test(offCreate.json.error ?? ""), "create saat okrEnabled=false → 409 fitur belum diaktifkan", String(offCreate.json.error));

  const offBoard = await owner.api("GET", `/api/rekankerja/performance/okr?quarter=${Q}`);
  ok(offBoard.status === 200 && offBoard.json.okrEnabled === false, "GET board tetap 200 + okrEnabled=false (banner UI)");

  // ================= 2. AKTIFKASI (HR — settings) =================
  console.log("\n[2] AKTIFKASI MODE OKR (settings HR)");
  const enable = await owner.api("POST", "/api/rekankerja/performance/settings", { okrEnabled: true });
  ok(enable.status === 200 && enable.json.setting?.okrEnabled === true, "POST settings {okrEnabled:true} → tersimpan");
  const settingsGet = await owner.api("GET", "/api/rekankerja/performance/settings");
  ok(settingsGet.status === 200 && settingsGet.json.setting?.okrEnabled === true, "GET settings memuat okrEnabled=true");

  // ================= 3. HR BUAT + POSTING OBJECTIVE BAMBAKNG =================
  console.log("\n[3] HR: OBJECTIVE BAMBAKNG → DRAFT → POSTED → BOARD ESS");
  const krSetA = [
    { title: "Kecepatan tutup buku bulanan (hari)", unit: "hari", polarity: "LowerIsBetter", baseline: 20, target: 4, weight: 40 },
    { title: "Akurasi jurnal (persen)", unit: "%", polarity: "HigherIsBetter", baseline: 90, target: 99, weight: 30 },
    { title: "Laporan analisis varian tersubmit", unit: "unit", polarity: "HigherIsBetter", baseline: 0, target: 12, weight: 30 },
  ];
  const createA = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Percepat & pertajam pelaporan keuangan kuartalan", ownerEmployeeId: bambang.id, keyResults: krSetA,
  });
  ok(createA.status === 201 && !!createA.json.id, "HR create objective Bambang 3 KR Σ100 → 201 Draft", `HTTP ${createA.status}`);
  const objAId = createA.json.id as string;

  // guard: KR 2 → 400; Σ90 → 400; kuartal salah; target=baseline; polarity salah
  console.log("\n[4] GUARD PAYLOAD NEGATIF");
  let r = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "KR terlalu sedikit", ownerEmployeeId: bambang.id,
    keyResults: [
      { title: "KR satu", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 60 },
      { title: "KR dua", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 40 },
    ],
  });
  ok(r.status === 400 && /3–5 item/i.test(r.json.error ?? ""), "create 2 KR → 400 (harus 3–5)", String(r.json.error));

  r = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Bobot tidak jumlah", ownerEmployeeId: bambang.id,
    keyResults: [
      { title: "KR satu", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 40 },
      { title: "KR dua", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 25 },
      { title: "KR tiga", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 25 },
    ],
  });
  ok(r.status === 400 && /harus 100/i.test(r.json.error ?? ""), "create Σbobot 90 → 400", String(r.json.error));

  r = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: "2026-Q5", title: "Kuartal salah", ownerEmployeeId: bambang.id, keyResults: krSetA,
  });
  ok(r.status === 400 && /format kuartal tidak valid/i.test(r.json.error ?? ""), 'kuartal "2026-Q5" → 400 (format YYYY-Qn)', String(r.json.error));

  r = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Target sama baseline", ownerEmployeeId: bambang.id,
    keyResults: [
      { title: "KR satu", unit: "%", polarity: "HigherIsBetter", baseline: 50, target: 50, weight: 40 },
      { title: "KR dua", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 30 },
      { title: "KR tiga", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 30 },
    ],
  });
  ok(r.status === 400 && /berbeda dari baseline/i.test(r.json.error ?? ""), "target = baseline → 400 (arah kemajuan tak terdefinisi)", String(r.json.error));

  r = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Polarity salah", ownerEmployeeId: bambang.id,
    keyResults: [
      { title: "KR satu", unit: "%", polarity: "Sideways", baseline: 0, target: 100, weight: 40 },
      { title: "KR dua", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 30 },
      { title: "KR tiga", unit: "%", polarity: "HigherIsBetter", baseline: 0, target: 100, weight: 30 },
    ],
  });
  ok(r.status === 400 && /polarity/i.test(r.json.error ?? ""), "polarity tak dikenal → 400", String(r.json.error));

  // D-BL3: Draft terlihat HR (pemilik = Bambang, viewer = HR)
  const boardDraft = await owner.api("GET", `/api/rekankerja/performance/okr?quarter=${Q}`);
  const draftRow = (boardDraft.json.rows ?? []).find((x: any) => x.id === objAId);
  ok(boardDraft.status === 200 && draftRow?.status === "Draft" && draftRow?.krs?.length === 3,
    "board HR: Draft Bambang terlihat (D-BL3 — HR melihat semua) + 3 KR terlist");

  // POSTING
  const postA = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "post", id: objAId });
  ok(postA.status === 200 && postA.json.status === "Posted", "HR posting objective Bambang → Posted (D-BL3)");

  // ESS yusuf melihat board silang-tim
  const yusufLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
  ok(yusufLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${yusufLogin.status}`);
  const essBoard0 = await yusuf.api("GET", `/api/rekankerja/ess/my-okr?quarter=${Q}`);
  const essRowA = (essBoard0.json.board ?? []).find((x: any) => x.id === objAId);
  ok(essBoard0.status === 200 && essRowA != null && essRowA.status === "Posted" && essRowA.krs.length === 3,
    "board ESS yusuf: objective Posted Bambang TAMPIL silang-tim (D-BL3) + 3 KR");
  ok((essBoard0.json.rows ?? []).length === 0, "ESS: tidak punya objective milik sendiri (awal kosong)");

  // ================= 5. ESS: BUAT + POST + UPDATE KR SENDIRI =================
  console.log("\n[5] ESS YUSUF: OBJECTIVE SENDIRI → DRAFT → POST → UPDATE KR");
  const krSetY = [
    { title: "CSAT tim layanan (persen)", unit: "%", polarity: "HigherIsBetter", baseline: 78, target: 90, weight: 40 },
    { title: "Backlog tiket tua (jumlah)", unit: "tiket", polarity: "LowerIsBetter", baseline: 40, target: 5, weight: 35 },
    { title: "Knowledge base baru (artikel)", unit: "artikel", polarity: "HigherIsBetter", baseline: 0, target: 10, weight: 25 },
  ];
  const createY = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", {
    action: "create", quarter: Q, title: "Angkat kualitas layanan pelanggan kuartal ini", keyResults: krSetY,
  });
  ok(createY.status === 201 && !!createY.json.id, "ESS create objective utk DIRI sendiri → 201 Draft", `HTTP ${createY.status}`);
  const objYId = createY.json.id as string;

  // ESS tidak bisa membuat utk orang lain (owner dipaksa self — uji lewat admin
  // endpoint sebagai non-HR? yusuf admin → 403 menu; lewat ESS payload ownerEmployeeId diabaikan)
  const createY2 = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", {
    action: "create", quarter: Q, title: "Coba inject owner orang lain", ownerEmployeeId: bambang.id, keyResults: krSetY,
  });
  ok(createY2.status === 201 && createY2.json.id !== objAId, "ESS payload ownerEmployeeId diabaikan — owner SELALU diri sendiri (anti-IDOR)");
  const objY2Row = await db.okrObjective.findUnique({ where: { id: createY2.json.id }, select: { ownerEmployeeId: true } });
  ok(objY2Row?.ownerEmployeeId === yusufEmp.id, "objektive hasil inject tetap milik yusuf (server-side clamp)");

  const postY = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", { action: "post", id: objYId });
  ok(postY.status === 200 && postY.json.status === "Posted", "ESS post objective miliknya sendiri → Posted (owner boleh — D-BL3)");

  const mine1 = await yusuf.api("GET", `/api/rekankerja/ess/my-okr?quarter=${Q}`);
  const myRow1 = (mine1.json.rows ?? []).find((x: any) => x.id === objYId);
  const beforePct = myRow1?.progressPct ?? 0;
  ok(myRow1 != null && beforePct === 0, `progres awal 0% (current = baseline saat create)`);

  const kr1 = myRow1.krs[0];
  const upKr = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", {
    action: "updateKr", id: kr1.id, current: 84, confidence: "Green", note: "CSAT naik setelah SOP baru",
  });
  ok(upKr.status === 200 && upKr.json.liveScore > 0, "ESS updateKr current 78→84 + confidence Green → 200", `live ${upKr.json.liveScore}`);

  const mine2 = await yusuf.api("GET", `/api/rekankerja/ess/my-okr?quarter=${Q}`);
  const myRow2 = (mine2.json.rows ?? []).find((x: any) => x.id === objYId);
  ok(myRow2.progressPct > beforePct, `progress live NAIK on-read (D-BL5): ${beforePct}% → ${myRow2.progressPct}%`);
  const krAfter = (myRow2.krs ?? []).find((k: any) => k.id === kr1.id);
  ok(krAfter && krAfter.confidence === "Green" && krAfter.note?.includes("SOP"), "confidence + note tersimpan di KR");

  // ================= 6. GUARD AKSES (anti-IDOR / menu-guard) =================
  console.log("\n[6] GUARD AKSES — anti-IDOR & menu-guard");
  const bambangKr = essRowA.krs[0];
  r = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", { action: "updateKr", id: bambangKr.id, current: 10 });
  ok(r.status === 403 && /pemilik|HR/i.test(r.json.error ?? ""), "ESS updateKr objective ORANG LAIN → 403", String(r.json.error));

  // draf milik Bambang — yusuf coba edit (owner check, bukan status check)
  const draftB = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Draf rahasia HR utk Bambang", ownerEmployeeId: bambang.id, keyResults: krSetA,
  });
  r = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", { action: "update", id: draftB.json.id, title: "Sabotase" });
  ok(r.status === 403, "ESS edit DRAF objective orang lain → 403 (owner check)", String(r.json.error));
  // draf orang lain juga tidak muncul di board ESS (D-BL3 — hanya Posted/Closed)
  const essBoardDraft = await yusuf.api("GET", `/api/rekankerja/ess/my-okr?quarter=${Q}`);
  ok(!(essBoardDraft.json.board ?? []).some((x: any) => x.id === draftB.json.id), "board ESS: Draft orang lain TIDAK tampil (D-BL3)");
  await owner.api("POST", "/api/rekankerja/performance/okr", { action: "delete", id: draftB.json.id });

  r = await yusuf.api("POST", "/api/rekankerja/ess/my-okr", { action: "close", id: objAId });
  ok(r.status === 400 && /aksi tidak dikenal/i.test(r.json.error ?? ""), "ESS aksi close tidak diekspos → 400 (close hanya HR)");

  r = await yusuf.api("GET", `/api/rekankerja/performance/okr?quarter=${Q}`);
  ok(r.status === 403, "ESS akses endpoint admin OKR → 403 (menu-guard performance:okr)", `HTTP ${r.status}`);

  // ================= 7. POHON ALIGN (D-BL4) =================
  console.log("\n[7] POHON ALIGN — mendukung objective lain");
  const alignOpts = await owner.api("GET", `/api/rekankerja/performance/okr?alignOptions=1&quarter=${Q}`);
  ok(alignOpts.status === 200 && (alignOpts.json.options ?? []).some((o: any) => o.id === objAId), "alignOptions memuat objective Posted kuartal sama");

  const tuti = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00013" }, select: { id: true, fullName: true } });
  const createB = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Otomasi rekonsiliasi bank utk percepat tutup buku", ownerEmployeeId: tuti.id, alignToId: objAId,
    keyResults: [
      { title: "Rekening terekonsiliasi otomatis (persen)", unit: "%", polarity: "HigherIsBetter", baseline: 30, target: 80, weight: 50 },
      { title: "Waktu rekonsiliasi (jam)", unit: "jam", polarity: "LowerIsBetter", baseline: 16, target: 4, weight: 50 },
    ],
  });
  ok(createB.status === 400, "align objective dgn KR 2 item → 400 (guard tetap jalan)");

  const createB2 = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Otomasi rekonsiliasi bank utk percepat tutup buku", ownerEmployeeId: tuti.id, alignToId: objAId,
    keyResults: [
      { title: "Rekening terekonsiliasi otomatis (persen)", unit: "%", polarity: "HigherIsBetter", baseline: 30, target: 80, weight: 50 },
      { title: "Waktu rekonsiliasi (jam)", unit: "jam", polarity: "LowerIsBetter", baseline: 16, target: 4, weight: 30 },
      { title: "Modul bank feed aktif (bank)", unit: "bank", polarity: "HigherIsBetter", baseline: 1, target: 4, weight: 20 },
    ],
  });
  ok(createB2.status === 201 && !!createB2.json.id, "HR create objective B align ke A → 201");
  const objBId = createB2.json.id as string;

  const boardAlign = await owner.api("GET", `/api/rekankerja/performance/okr?quarter=${Q}`);
  const rowB = (boardAlign.json.rows ?? []).find((x: any) => x.id === objBId);
  ok(rowB?.alignParentTitle === "Percepat & pertajam pelaporan keuangan kuartalan", "board menampilkan chip align (alignParentTitle = judul A)");

  const detailA = await owner.api("GET", `/api/rekankerja/performance/okr?id=${objAId}`);
  ok(detailA.status === 200 && (detailA.json.alignChildren ?? []).some((c: any) => c.id === objBId), "detail A menampilkan anak align (pohon dukungan 1 level)");

  // guard siklus: C → D → C
  const createC = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Siklus uji C", ownerEmployeeId: bambang.id,
    keyResults: krSetA,
  });
  const createD = await owner.api("POST", "/api/rekankerja/performance/okr", {
    action: "create", quarter: Q, title: "Siklus uji D", ownerEmployeeId: bambang.id, alignToId: createC.json.id,
    keyResults: krSetA,
  });
  ok(createC.status === 201 && createD.status === 201, "Draft C + D (D align C) dibuat");
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "update", id: createC.json.id, alignToId: createD.json.id });
  ok(r.status === 400 && /melingkar/i.test(r.json.error ?? ""), "guard siklus: C align D + D align C → 400 pohon melingkar", String(r.json.error));

  // ================= 8. CLOSE + SKOR FINAL (D-BL5, HR saja) =================
  console.log("\n[8] CLOSE KUARTAL — skor final server (HR saja)");
  // isi progres Bambang ke nilai dikenal
  const detailA2 = (await owner.api("GET", `/api/rekankerja/performance/okr?id=${objAId}`)).json.row;
  const updates = [
    { id: detailA2.krs[0].id, current: 8 },    // LowerIsBetter 20→4, current 8 → (20-8)/16 = 0.75
    { id: detailA2.krs[1].id, current: 95.4 }, // 90→99, current 95.4 → 5.4/9 = 0.6
    { id: detailA2.krs[2].id, current: 12 },   // 0→12, current 12 → 1.0 (tepat target)
  ];
  for (const u of updates) {
    const res = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "updateKr", id: u.id, current: u.current });
    if (res.status !== 200) ok(false, `updateKr ${u.id} → ${res.status}`, String(res.json.error));
  }
  const boardPre = await owner.api("GET", `/api/rekankerja/performance/okr?quarter=${Q}`);
  const preRow = (boardPre.json.rows ?? []).find((x: any) => x.id === objAId);
  const expected = calcScore(preRow.krs);
  ok(Math.abs(preRow.progressPct - Math.round(expected * 100)) < 1, `progress live on-read = rumus D-BL5 (${preRow.progressPct}% ≈ ${Math.round(expected * 100)}%)`);

  // ESS coba close via admin endpoint → 403 menu-guard (role ESS) — sudah diuji
  // (no.6). Close oleh HR:
  const closeA = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "close", id: objAId });
  ok(closeA.status === 200 && closeA.json.status === "Closed" && Math.abs((closeA.json.closedScore ?? 0) - expected) < 0.005,
    `close oleh HR → Closed + closedScore = hitungan manual (${closeA.json.closedScore} vs ${expected})`);

  const boardPost = await owner.api("GET", `/api/rekankerja/performance/okr?quarter=${Q}`);
  const closedRow = (boardPost.json.rows ?? []).find((x: any) => x.id === objAId);
  ok(closedRow?.status === "Closed" && closedRow?.closedScore != null && Math.abs(closedRow.closedScore - expected) < 0.005,
    "board menampilkan Closed + skor final tersimpan (D-BL5 — disimpan SAAT close)");

  // guard pasca-closed: updateKr & post & edit → 409
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "updateKr", id: detailA2.krs[0].id, current: 2 });
  ok(r.status === 409, "updateKr pasca-Closed → 409 (terkunci)", `HTTP ${r.status}`);
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "post", id: objAId });
  ok(r.status === 409 && /posting hanya dari draft/i.test(r.json.error ?? ""), "post pasca-Closed → 409 (transisi satu arah)", String(r.json.error));
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "update", id: objAId, title: "Ubah pasca close" });
  ok(r.status === 409, "edit pasca-Closed → 409");
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "delete", id: objAId });
  ok(r.status === 409 && /draft/i.test(r.json.error ?? ""), "delete pasca-Closed → 409 (hanya Draft yang bisa dihapus)");

  // Closed tetap terlihat di board ESS (riwayat transparan)
  const essBoardEnd = await yusuf.api("GET", `/api/rekankerja/ess/my-okr?quarter=${Q}`);
  const essClosed = (essBoardEnd.json.board ?? []).find((x: any) => x.id === objAId);
  ok(essClosed?.status === "Closed" && essClosed?.closedScore != null, "board ESS: Closed tetap terbaca dgn skor final (riwayat)");

  // ================= 9. OVERVIEW (okrSummary) =================
  console.log("\n[9] OVERVIEW — okrSummary di dashboard laporan");
  // posting objective align B dulu supaya >1 Posted di kuartal berjalan
  await owner.api("POST", "/api/rekankerja/performance/okr", { action: "post", id: objBId });
  const reports = await owner.api("GET", "/api/rekankerja/performance/reports");
  const os = reports.json.okrSummary;
  ok(reports.status === 200 && os != null && os.quarter === Q, `okrSummary muncul saat aktif (quarter ${os?.quarter})`);
  ok(os?.posted >= 2, `okrSummary.posted menghitung objective Posted (${os?.posted} — yusuf + align B)`);

  // ================= 10. DRAFT delete (owner) =================
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "delete", id: createD.json.id });
  ok(r.status === 200, "delete Draft D oleh HR → 200");
  const dRow = (createC.json as { id: string });
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "update", id: dRow.id, title: "Siklus uji C (revisi)" });
  ok(r.status === 200, "edit Draft C → 200 (Draft boleh diedit penuh)");
  r = await owner.api("POST", "/api/rekankerja/performance/okr", { action: "delete", id: dRow.id });
  ok(r.status === 200, "bersih-bersih Draft C");

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
