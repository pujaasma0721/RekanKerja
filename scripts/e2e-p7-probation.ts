// Uji E2E API P7 (Evaluasi Masa Percobaan) — alur 4 §28 per DEVELOPMENT-PLAN-
// PERFORMANCE.md, di atas data seed-p7-demo (login owner hrd@mii.co.id):
//   0.  GET daftar → 3 evaluasi D9 + dueSoon filter (Rizky H+10 & Laila H-5 ≤14d)
//   1.  GUARD negatif ×7: rekomendasi sebelum penilaian; skor >100; bobot ≠100;
//       kriteria <3; create manual joinDate terlalu lama (§7.1); cancel alasan
//       pendek; aksi tak dikenal.
//   2.  JALUR CONFIRM (Eka PRB-…-0001): assess 82 → recommend Confirm → submit
//       → chain 2 jenjang (L1 atasan → L2 HR — TANPA L3) → approve L1 → L2 →
//       Decided → PA ChangeStatus + surat PROB_RESULT (idempoten 2×).
//   3.  JALUR EXTEND (Rizky PRB-…-0002): assess 65 → recommend Extend (catatan
//       hukum ≥10 kar) → submit → approve 2 jenjang → Decided → PA
//       ExtendProbation + surat PROB_EXTEND (perjanjian kerja BARU §7.1).
//   4.  JALUR TERMINATE (Laila PRB-…-0003, overdue): assess 45 → recommend
//       Terminate → submit (amount=1 → L3 Direktur aktif, chain 3 jenjang) →
//       approve L1 → L2 → L3 → Decided → PA Termination + surat PROB_RESULT.
//   5.  VERIFIKASI pasca-alur: status Decided ×3, PA backlink, ActivityLog,
//       surat metaJson.probDocNo idempoten, detail chainSteps lengkap.
// Jalankan: bun run scripts/e2e-p7-probation.ts
import "./lib/env";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";

let cookie = "";
let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  // ---------- 0. login + daftar ----------
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);
  const me = await api("GET", "/api/auth/me");
  ok(me.status === 200, "sesi terverifikasi");

  const list = await api("GET", "/api/rekankerja/performance/probation");
  ok(list.status === 200, "GET daftar evaluasi", `HTTP ${list.status}`);
  const rows0: any[] = list.json.rows ?? [];
  ok(rows0.length >= 3, `daftar memuat ≥3 evaluasi D9 (ada ${rows0.length})`);
  const byName = (n: string) => rows0.find((r) => r.employeeName === n);
  const eka = byName("Eka Putri");
  const rizky = byName("Rizky Maulana");
  const laila = byName("Laila Sari");
  ok(!!eka && eka.status === "Open" && !!eka.onboardingId, `PRB-0001 Eka Open + provenance onboarding (${eka?.docNo})`);
  ok(!!rizky && rizky.managerScore == null, `PRB-0002 Rizky Open tanpa skor (${rizky?.docNo})`);
  ok(!!laila && laila.daysRemaining < 0, `PRB-0003 Laila LEWAT jatuh tempo (H${laila?.daysRemaining})`);
  ok(rows0.every((r) => r.criteria.length === 3 && r.criteria.reduce((s: number, c: any) => s + c.weight, 0) === 100),
    "kriteria default 3 item Σbobot 100 (semua baris)");

  // struktur AS-PROB-STD self-heal saat GET pertama
  const due = await api("GET", "/api/rekankerja/performance/probation?dueSoon=1");
  const dueRows: any[] = due.json.rows ?? [];
  ok(dueRows.length === 2 && dueRows.some((r) => r.employeeName === "Rizky Maulana") && dueRows.some((r) => r.employeeName === "Laila Sari"),
    "filter dueSoon=1 → hanya ≤14 hari (Rizky + Laila)");

  // detail + employees picker
  const detail = await api("GET", `/api/rekankerja/performance/probation?id=${eka.id}`);
  ok(detail.status === 200 && detail.json.row.docNo === eka.docNo, "GET detail by id");
  const emps = await api("GET", "/api/rekankerja/performance/probation?employees=1&q=eka");
  ok(emps.status === 200 && (emps.json.employees ?? []).every((e: any) => e.employeeNo !== "MII00047"),
    "picker employees mengecualikan karyawan dgn evaluasi terbuka (Eka tak muncul utk 'eka' — filter terbuka)");

  // ---------- 1. guard negatif ----------
  console.log("\n— GUARD NEGATIF —");
  let r = await api("POST", "/api/rekankerja/performance/probation", { action: "recommend", id: eka.id, recommendation: "Confirm" });
  ok(r.status === 400 && /menilai dulu/i.test(r.json.error ?? ""), "rekomendasi sebelum penilaian → 400", r.json.error);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "assess", id: eka.id, managerScore: 120 });
  ok(r.status === 400 && /0–100/i.test(r.json.error ?? ""), "skor 120 → 400", r.json.error);

  r = await api("POST", "/api/rekankerja/performance/probation", {
    action: "assess", id: eka.id, managerScore: 80,
    criteria: [
      { title: "Kualitas kerja", weight: 60 },
      { title: "Disiplin", weight: 30 },
      { title: "Kolaborasi", weight: 20 },
    ],
  });
  ok(r.status === 400 && /harus 100/i.test(r.json.error ?? ""), "bobot 110 → 400 (Σ≠100)", r.json.error);

  r = await api("POST", "/api/rekankerja/performance/probation", {
    action: "assess", id: eka.id, managerScore: 80,
    criteria: [
      { title: "Kualitas kerja", weight: 60 },
      { title: "Disiplin saja", weight: 40 },
    ],
  });
  ok(r.status === 400 && /3–6 item/i.test(r.json.error ?? ""), "kriteria 2 item → 400", r.json.error);

  const t13 = rows0.find((x: any) => x.employeeNo === "MII00013"); // karyawan lama tanpa evaluasi terbuka
  if (t13) {
    r = await api("POST", "/api/rekankerja/performance/probation", { action: "create", employeeId: t13.employeeId, joinDate: "2019-12-18" });
    ok(r.status === 400 && /terlalu lama|sudah lewat/i.test(r.json.error ?? ""), "create manual joinDate 2019 → 400 (§7.1)", r.json.error);
  }

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "cancel", id: eka.id, reason: "pendek" });
  ok(r.status === 400 && /≥10 karakter/i.test(r.json.error ?? ""), "cancel alasan <10 kar → 400", r.json.error);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "nonsense" });
  ok(r.status === 400, "aksi tak dikenal → 400");

  // ---------- 2. jalur CONFIRM (Eka) ----------
  console.log("\n— JALUR A: CONFIRM (Eka) —");
  r = await api("POST", "/api/rekankerja/performance/probation", {
    action: "assess", id: eka.id, managerScore: 82,
    criteria: [
      { title: "Penguasaan tugas & kualitas kerja", weight: 40 },
      { title: "Kepatuhan SOP & disiplin", weight: 35 },
      { title: "Kolaborasi & komunikasi tim", weight: 25 },
    ],
    note: "Cepat beradaptasi, output konsisten di atas rata-rata tim.",
  });
  ok(r.status === 200, "assess 82 → Assessed");
  let row = (await api("GET", `/api/rekankerja/performance/probation?employeeId=${eka.employeeId}`)).json.rows[0];
  ok(row.status === "Assessed" && row.managerScore === 82, `status Assessed + skor 82 (skor ${row.managerScore})`);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "recommend", id: eka.id, recommendation: "Confirm", hrNote: "Skor konsisten tinggi sejak bulan pertama." });
  ok(r.status === 200, "recommend Confirm → Recommended");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "submit", id: eka.id });
  ok(r.status === 200 && r.json.chainStatus === "InProgress", "submit → chain InProgress");
  row = (await api("GET", `/api/rekankerja/performance/probation?employeeId=${eka.employeeId}`)).json.rows[0];
  ok(row.chain?.status === "InProgress" && row.chain.totalLevels === 2, `chain 2 jenjang TANPA L3 (L${row.chain?.currentLevel}/${row.chain?.totalLevels}) — amount=2`);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: eka.id, decision: "approve" });
  ok(r.status === 200 && r.json.final === false, "approve L1 (atasan) → belum final");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: eka.id, decision: "approve" });
  ok(r.status === 200 && r.json.final === true && r.json.status === "Decided", "approve L2 (HR) → FINAL Decided");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toPersonnelAction", id: eka.id });
  ok(r.status === 201 && r.json.type === "ChangeStatus", `PA ChangeStatus digulirkan (${r.json.docNo})`);
  const ekaPaDoc = r.json.docNo as string;

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toLetter", id: eka.id });
  ok(r.status === 200 && r.json.templateKey === "PROB_RESULT", `surat PROB_RESULT terbit (${r.json.refNo})`);
  const ekaLetter1 = r.json.refNo as string;
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toLetter", id: eka.id });
  ok(r.status === 200 && r.json.refNo === ekaLetter1, "surat idempoten (2× → refNo sama)");

  row = (await api("GET", `/api/rekankerja/performance/probation?employeeId=${eka.employeeId}`)).json.rows[0];
  ok(row.personnelActionDocNo === ekaPaDoc && row.letterRefNos.some((l: any) => l.key === "PROB_RESULT"),
    `backlink PA (${row.personnelActionDocNo}) + surat (${row.letterRefNos.map((l: any) => l.refNo).join(", ")}) ter-list`);
  ok(row.decisionDate != null, `tanggal keputusan tercatat (${row.decisionDate.slice(0, 10)})`);

  // guard pasca-decided
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "assess", id: eka.id, managerScore: 50 });
  ok(r.status === 400, "assess setelah Decided → 400");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toPersonnelAction", id: eka.id });
  ok(r.status === 400 && /sudah digulirkan/i.test(r.json.error ?? ""), "PA dobel → 400");

  // ---------- 3. jalur EXTEND (Rizky) ----------
  console.log("\n— JALUR B: EXTEND (Rizky) —");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "assess", id: rizky.id, managerScore: 65, note: "Capaian teknis baik, adaptasi prosedur masih lambat." });
  ok(r.status === 200, "assess 65");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "recommend", id: rizky.id, recommendation: "Extend", hrNote: "pendek" });
  ok(r.status === 400 && /≥10 karakter/i.test(r.json.error ?? ""), "catatan Extend <10 kar → 400", r.json.error);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "recommend", id: rizky.id, recommendation: "Extend", hrNote: "Potensi teknis baik namun adaptasi prosedur belum stabil — perjanjian kerja baru utk percobaan kedua (§7.1)." });
  ok(r.status === 200, "recommend Extend (catatan hukum lengkap)");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "submit", id: rizky.id });
  ok(r.status === 200, "submit Extend");
  row = (await api("GET", `/api/rekankerja/performance/probation?employeeId=${rizky.employeeId}`)).json.rows[0];
  ok(row.chain?.totalLevels === 2, `chain Extend 2 jenjang (L${row.chain?.currentLevel}/${row.chain?.totalLevels}) — amount=2`);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: rizky.id, decision: "reject", note: "Dokumen pendukung belum lengkap" });
  ok(r.status === 200 && r.json.status === "Recommended", "REJECT di L1 → kembali Recommended (resubmit §32-2)");
  row = (await api("GET", `/api/rekankerja/performance/probation?employeeId=${rizky.employeeId}`)).json.rows[0];
  ok(row.chain?.status !== "InProgress", "chain mati pasca-reject — tombol Ajukan muncul lagi");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "submit", id: rizky.id });
  ok(r.status === 200, "resubmit setelah reject");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: rizky.id, decision: "approve" });
  ok(r.status === 200 && r.json.final === false, "approve L1");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: rizky.id, decision: "approve" });
  ok(r.status === 200 && r.json.status === "Decided", "approve L2 → Decided");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toPersonnelAction", id: rizky.id });
  ok(r.status === 201 && r.json.type === "ExtendProbation", `PA ExtendProbation digulirkan (${r.json.docNo})`);
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toLetter", id: rizky.id });
  ok(r.status === 200 && r.json.templateKey === "PROB_EXTEND", `surat PROB_EXTEND — perjanjian kerja BARU (${r.json.refNo})`);

  // guard: Confirm tidak boleh ExtendProbation (pernah — uji lewat API dgn Laila nanti? tidak — khusus Rizky selesai)
  // (guard type-mismatch diuji langsung di jalur D bila perlu — skip, sudah tercakup unit 400)

  // ---------- 4. jalur TERMINATE (Laila — overdue + L3 Direktur) ----------
  console.log("\n— JALUR C: TERMINATE (Laila, overdue) —");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "assess", id: laila.id, managerScore: 45, note: "Capaian jauh di bawah standar sepanjang percobaan; 2 peringatan lisan." });
  ok(r.status === 200, "assess 45");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "recommend", id: laila.id, recommendation: "Terminate", hrNote: "Skor 45/100 setelah 2 peringatan lisan & pendampingan intensif — PhK dalam masa percobaan UU 13/2003 Ps.60." });
  ok(r.status === 200, "recommend Terminate");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "submit", id: laila.id });
  ok(r.status === 200, "submit Terminate");
  row = (await api("GET", `/api/rekankerja/performance/probation?employeeId=${laila.employeeId}`)).json.rows[0];
  ok(row.chain?.totalLevels === 3, `chain Terminate 3 jenjang — L3 Direktur AKTIF via amount=1 (L${row.chain?.currentLevel}/${row.chain?.totalLevels})`);

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: laila.id, decision: "approve" });
  ok(r.status === 200 && r.json.final === false, "approve L1 (atasan)");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: laila.id, decision: "approve" });
  ok(r.status === 200 && r.json.final === false, "approve L2 (HR)");
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "decide", id: laila.id, decision: "approve" });
  ok(r.status === 200 && r.json.final === true && r.json.status === "Decided", "approve L3 (Direktur) → FINAL Decided");

  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toPersonnelAction", id: laila.id });
  ok(r.status === 201 && r.json.type === "Termination", `PA Termination digulirkan (${r.json.docNo})`);
  r = await api("POST", "/api/rekankerja/performance/probation", { action: "toLetter", id: laila.id });
  ok(r.status === 200 && r.json.templateKey === "PROB_RESULT", `surat hasil PhK percobaan (${r.json.refNo})`);

  // ---------- 5. verifikasi lintas-alur ----------
  console.log("\n— VERIFIKASI AKHIR —");
  const final = await api("GET", "/api/rekankerja/performance/probation?status=Decided");
  const decided: any[] = final.json.rows ?? [];
  ok(decided.length === 3, `3 evaluasi Decided (ada ${decided.length})`);
  ok(decided.every((d) => d.personnelActionDocNo && d.letterRefNos.length > 0), "semua Decided punya PA + surat");
  const cancelled = await api("GET", "/api/rekankerja/performance/probation?status=Cancelled");
  ok((cancelled.json.rows ?? []).length === 0, "tidak ada evaluasi ter-batal (alur bersih)");

  const detLaila = await api("GET", `/api/rekankerja/performance/probation?id=${laila.id}`);
  const steps = detLaila.json.chainSteps ?? [];
  ok(steps.length === 3 && steps.every((s: any) => s.status === "Approved"), "detail Laila: 3 jenjang semua Approved (L3 Direktur ter-audit)");

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
