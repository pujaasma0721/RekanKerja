// P1.3-BM (D-BM7) — E2E REGULARISASI ABSENSI MANDIRI (local dev :3000):
//   (1) ESS submit MissingClockIn utk hari kerja lampau → 201 + AR-YYYY-NNNN +
//       chain AttendanceReg + muncul di daftar admin (status Submitted + jam
//       rekap saat ini utk diff);
//   (2) tanggal masa depan → 400; (2b) backdate >30 hari → 400;
//   (3) alasan <10 karakter → 400; (3b) kind↔jam tidak konsisten → 400;
//   (3c) attachmentIds palsu → 400 "Lampiran tidak valid";
//   (4) admin approve → request Approved + AttendanceDaily tanggal tsb
//       checkIn terisi & state "Revised" (verifikasi DB + GET admin clocking +
//       daftar admin current) + decidedById tercatat + ulang putus → 409;
//   (5) admin reject tanpa note → 400; dengan note ≥10 → Rejected +
//       decisionNote + rekap TIDAK tersentuh (bukan Revised);
//   (6) cap D-BM7: 4 pengajuan Submitted bulan kalender sama → submit ke-5
//       (tanggal beda, bulan sama) → 429; monthQuotaLeft ESS = 0;
//       lampiran draf salah satu submit ter-bind ke dokumen;
//   (7) ESS cancel own Submitted → Cancelled + chain Cancelled + kuota
//       kembali (monthQuotaLeft 1) + cancel ulang → 409 + cancel dokumen
//       berstatus Approved → 409;
//   (8) guard: sesi ESS memanggil API admin → 403;
//   (9) CLEANUP: restore AttendanceDaily yang disentuh (pra-uji) + hapus
//       pengajuan/chain/notifikasi/lampiran uji (ActivityLog DIPERTAHANKAN —
//       audit trail, pola B8/P1.1).
// Jalankan: bun scripts/e2e-p1-regularization.ts  (server dev di :3000)
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const ADMIN = { email: "hrd@mii.co.id", password: "onevity123" };
const ESS = { email: "yusuf@mii.co.id", password: "EssDemo123!" };
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const ADMIN_API = "/api/rekankerja/attendance/regularization";
const ESS_API = "/api/rekankerja/ess/regularization";
const NONCE = `e2e-p13-${Date.now().toString().slice(-6)}`;

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) — pola e2e-b8/P1.1.
 *  Retry ringan utk gangguan socket transient (dev server shared sandbox —
 *  recompile/watchdog bisa memutus koneksi sesaat; TIDAK me-retry status HTTP). */
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
        try { json = JSON.parse(text); } catch { /* body non-JSON */ }
        return { status: res.status, json, text };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

/** "YYYY-MM-DD" lokal tanpa timezone-shift (konvensi app). */
const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "HH:MM" lokal dari string ISO (server & skrip ini satu mesin/ satu TZ). */
const hhmmOf = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

async function main() {
  const startedAt = new Date();
  console.log(`E2E P1.3 regularisasi absensi — ${startedAt.toISOString()} (nonce ${NONCE})`);
  const db = getTenantClient(SCHEMA);

  // ================= (0) SETUP =================
  const yusuf = await db.employee.findFirst({
    where: { employeeNo: "MII00010" },
    select: { id: true, employeeNo: true, fullName: true, status: true },
  });
  const hrdUser = await db.appUser.findFirst({
    where: { email: ADMIN.email },
    select: { id: true, fullName: true, username: true },
  });
  if (!yusuf || !hrdUser) { console.error("akun uji tidak ditemukan"); process.exit(1); }
  ok(yusuf.status === "Active", "karyawan uji (yusuf) aktif", yusuf.employeeNo);

  const admin = new Sesi();
  const ess = new Sesi();
  const adminLogin = await admin.api("POST", "/api/auth/login", ADMIN);
  const essLogin = await ess.api("POST", "/api/auth/login", ESS);
  ok(adminLogin.status === 200, "login admin (hrd)");
  ok(essLogin.status === 200, "login ESS (yusuf)");
  if (adminLogin.status !== 200 || essLogin.status !== 200) process.exit(1);

  // ---- pilihan tanggal (lokal, konvensi app) ----
  const today = dayStart(new Date());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
  // kandidat hari kerja lampau: kemarin mundur maks 29 hari, Sen–Jum, urut terbaru.
  const pastWeekdays: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    if (isWeekday(d)) pastWeekdays.push(isoLocal(d));
  }
  ok(pastWeekdays.length >= 2, "cukup hari kerja lampau dalam jendela 30 hari", `${pastWeekdays.length} tanggal`);
  const D1 = pastWeekdays[0]; // approve test
  const D2 = pastWeekdays[1]; // reject test

  // 5 tanggal beda dalam SATU bulan kalender (cap test) — prioritas hari kerja,
  // di luar D1/D2; fallback akhir pekan bila bulan tinggal sedikit.
  const used = new Set([D1, D2]);
  const pool: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const s = isoLocal(d);
    if (!used.has(s)) pool.push(s);
  }
  const byMonth = new Map<string, string[]>();
  for (const s of pool) {
    const ym = s.slice(0, 7);
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), s]);
  }
  let capDates: string[] = [];
  for (const [ym, list] of byMonth) {
    if (list.length < 5) continue; // butuh 5 tanggal beda (4 aktif + 1 percobaan 429)
    const wd = list.filter((s) => isWeekday(new Date(`${s}T00:00:00`)));
    const pick = (wd.length >= 5 ? wd : list).slice(0, 5);
    capDates = pick;
    console.log(`  cap dates (${ym}): ${pick.join(", ")}`);
    break;
  }
  ok(capDates.length === 5, "5 tanggal uji cap dalam satu bulan kalender ditemukan");
  if (capDates.length !== 5) { console.error("tidak cukup tanggal utk uji cap — cek seed/jam mesin"); process.exit(1); }
  const [DC1, DC2, DC3, DC4, DC5] = capDates;

  // ---- pra-bersih (idempoten utk re-run): pengajuan yusuf lama + chain + notif ----
  const staleRows = await db.attendanceRegularizationRequest.findMany({
    where: { employeeId: yusuf.id },
    select: { id: true, docNo: true },
  });
  if (staleRows.length > 0) {
    const staleIds = staleRows.map((r) => r.id);
    await db.approvalChain.deleteMany({ where: { docType: "AttendanceReg", docId: { in: staleIds } } });
    await db.notification.deleteMany({
      where: { OR: staleRows.map((r) => ({ title: { contains: r.docNo } })) },
    });
    await db.attachment.deleteMany({ where: { entityType: "AttendanceRegularization", entityId: { in: staleIds } } });
    await db.attendanceRegularizationRequest.deleteMany({ where: { id: { in: staleIds } } });
    console.log(`  pra-bersih: ${staleRows.length} pengajuan yusuf lama dihapus`);
  }
  const arBefore = await db.attendanceRegularizationRequest.count();
  const dailyBefore = await db.attendanceDaily.count();
  const logBefore = await db.activityLog.count({
    where: { entity: "AttendanceRegularizationRequest" },
  });

  // ================= (1) ESS submit MissingClockIn hari kerja lampau =================
  console.log("\n[(1)] ESS submit MissingClockIn — hari kerja lampau");
  const reason1 = `${NONCE} lupa clock in pagi — QR kiosk error saat masuk`;
  const r1 = await ess.api("POST", ESS_API, {
    workDate: D1, kind: "MissingClockIn", clockIn: "08:05", reason: reason1,
  });
  ok(r1.status === 201, "submit → 201", `status=${r1.status}`);
  const docNo1: string | undefined = r1.json?.docNo;
  const id1: string | undefined = r1.json?.id;
  ok(!!docNo1 && new RegExp(`^AR-${today.getFullYear()}-\\d{4}$`).test(docNo1), "docNo AR-YYYY-NNNN", docNo1);
  ok(r1.json?.status === "Submitted" && (r1.json?.approvalLevels ?? 0) >= 1, "status Submitted + chain ≥1 jenjang",
    `levels=${r1.json?.approvalLevels} approver=${r1.json?.firstApprover ?? "?"}`);
  if (!id1 || !docNo1) { console.error("submit gagal — hentikan"); process.exit(1); }

  const chain1 = await db.approvalChain.findFirst({
    where: { docType: "AttendanceReg", docId: id1 },
    include: { steps: true },
  });
  ok(!!chain1 && chain1.status === "InProgress" && chain1.steps.length >= 1,
    "chain AttendanceReg dibuat (InProgress, anti-deadlock ≥1 jenjang)",
    chain1 ? `${chain1.steps.length} jenjang (${chain1.steps[0]?.approverLabel})` : "-");
  const logSub1 = await db.activityLog.findFirst({
    where: { entity: "AttendanceRegularizationRequest", entityId: docNo1, action: "Submitted" },
  });
  ok(!!logSub1, "ActivityLog Submitted tercatat");

  // daftar admin memuat pengajuan + jam rekap saat ini (utk diff display).
  const adminList1 = await admin.api("GET", `${ADMIN_API}?status=Submitted`);
  const row1 = (adminList1.json?.rows ?? []).find((r: any) => r.id === id1);
  ok(adminList1.status === 200 && !!row1, "daftar admin menampilkan pengajuan baru (Submitted)");
  ok(row1?.current != null && row1.current.checkIn == null, "daftar admin membawa jam rekap saat ini (checkIn kosong — Absen)",
    `current=${JSON.stringify(row1?.current)}`);
  ok(Array.isArray(row1?.attachments), "metadata lampiran (kosong) di daftar admin");

  // ESS list + stats.
  const myList1 = await ess.api("GET", ESS_API);
  ok(myList1.status === 200 && (myList1.json?.rows ?? []).some((r: any) => r.docNo === docNo1),
    "daftar ESS 'Pengajuan Saya' memuat dokumen");
  ok((myList1.json?.stats?.submitted ?? 0) >= 1, "stats ESS submitted ≥ 1");

  // ================= (2) tanggal masa depan → 400 =================
  console.log("\n[(2)] guard tanggal");
  const future = isoLocal(new Date(today.getTime() + 7 * 86_400_000));
  const rFut = await ess.api("POST", ESS_API, {
    workDate: future, kind: "MissingClockIn", clockIn: "08:00", reason: `${NONCE} tes masa depan`,
  });
  ok(rFut.status === 400 && /masa depan|future/i.test(rFut.json?.error ?? rFut.text),
    "tanggal masa depan → 400", `status=${rFut.status}`);
  const tooOld = isoLocal(new Date(today.getTime() - 40 * 86_400_000));
  const rOld = await ess.api("POST", ESS_API, {
    workDate: tooOld, kind: "MissingClockIn", clockIn: "08:00", reason: `${NONCE} tes backdate jauh`,
  });
  ok(rOld.status === 400 && /30 hari/.test(rOld.json?.error ?? ""), "backdate >30 hari → 400", `status=${rOld.status}`);

  // ================= (3) validasi input =================
  console.log("\n[(3)] validasi alasan / kind↔jam / lampiran palsu");
  const rShort = await ess.api("POST", ESS_API, {
    workDate: D2, kind: "MissingClockOut", clockOut: "17:30", reason: "pendek",
  });
  ok(rShort.status === 400 && /10 karakter/.test(rShort.json?.error ?? ""),
    "alasan <10 karakter → 400", `status=${rShort.status}`);
  const rNoTime = await ess.api("POST", ESS_API, {
    workDate: D2, kind: "MissingClockIn", reason: `${NONCE} jam kosong utk kind ini`,
  });
  ok(rNoTime.status === 400 && /Jam masuk/.test(rNoTime.json?.error ?? ""),
    "MissingClockIn tanpa clockIn → 400", `status=${rNoTime.status}`);
  const rBadKind = await ess.api("POST", ESS_API, {
    workDate: D2, kind: "Ngasal", clockIn: "08:00", reason: `${NONCE} jenis tidak dikenal`,
  });
  ok(rBadKind.status === 400, "kind tak dikenal → 400", `status=${rBadKind.status}`);
  const rFakeAtt = await ess.api("POST", ESS_API, {
    workDate: D2, kind: "MissingClockOut", clockOut: "17:30",
    reason: `${NONCE} attachment id palsu`, attachmentIds: ["id-palsu-e2e"],
  });
  ok(rFakeAtt.status === 400 && /Lampiran tidak valid/.test(rFakeAtt.json?.error ?? ""),
    "attachmentIds palsu → 400 'Lampiran tidak valid'", `status=${rFakeAtt.status}`);
  const rBadTime = await ess.api("POST", ESS_API, {
    workDate: D2, kind: "WrongTime", clockIn: "25:99", clockOut: "17:00", reason: `${NONCE} format jam salah`,
  });
  ok(rBadTime.status === 400, "format jam tidak valid → 400", `status=${rBadTime.status}`);

  // ================= (4) admin approve → auto-apply override + regen =================
  console.log("\n[(4)] admin approve → AttendanceDaily Revised");
  const priorRow = await db.attendanceDaily.findUnique({
    where: { employeeId_workDate: { employeeId: yusuf.id, workDate: new Date(`${D1}T00:00:00`) } },
  });
  const approve1 = await admin.api("PATCH", ADMIN_API, { id: id1, action: "approve" });
  ok(approve1.status === 200 && approve1.json?.status === "Approved",
    "approve → 200 status Approved", `status=${approve1.status} body=${JSON.stringify(approve1.json)}`);

  const req1Db = await db.attendanceRegularizationRequest.findUnique({ where: { id: id1 } });
  ok(req1Db?.status === "Approved", "DB: request Approved");
  ok(req1Db?.decidedById === hrdUser.id, "DB: decidedById = approver admin (hrd)", req1Db?.decidedById ?? "-");
  ok(!!req1Db?.decidedAt, "DB: decidedAt terisi");

  const daily1 = await db.attendanceDaily.findUnique({
    where: { employeeId_workDate: { employeeId: yusuf.id, workDate: new Date(`${D1}T00:00:00`) } },
  });
  ok(!!daily1, "AttendanceDaily tanggal tsb ada (regen upsert)");
  ok(daily1?.state === "Revised" && daily1?.revised === true,
    "DB: state 'Revised' + revised flag", `state=${daily1?.state} revised=${daily1?.revised}`);
  ok(!!daily1?.revisedBy && typeof daily1.revisedBy === "string" && daily1.revisedBy.length > 0,
    "DB: revisedBy tercatat", daily1?.revisedBy ?? "-");
  ok(hhmmOf(daily1?.checkIn?.toISOString() ?? null) === "08:05",
    "DB: checkIn terisi jam diajukan (08:05)", hhmmOf(daily1?.checkIn?.toISOString() ?? null) ?? "-");
  ok(!!daily1?.notes && daily1.notes.includes(docNo1), "DB: notes memuat 'Regularisasi {docNo}'", daily1?.notes ?? "-");

  // verifikasi jalur API admin (GET clocking — kontrak halaman admin).
  const clockingGet = await admin.api("GET", `/api/rekankerja/attendance/clocking?date=${D1}`);
  const clockRow = (clockingGet.json?.rows ?? []).find((r: any) => r.employeeId === yusuf.id);
  ok(clockingGet.status === 200 && hhmmOf(clockRow?.checkIn) === "08:05",
    "GET admin clocking: checkIn rekap = 08:05", `status=${clockingGet.status} in=${hhmmOf(clockRow?.checkIn) ?? "-"}`);

  // daftar admin menampilkan current ter-update (diff after).
  const adminList2 = await admin.api("GET", `${ADMIN_API}?status=Approved`);
  const row1b = (adminList2.json?.rows ?? []).find((r: any) => r.id === id1);
  ok(adminList2.status === 200 && row1b?.current?.checkIn === "08:05" && row1b?.current?.state === "Revised",
    "daftar admin (filter Approved): current.checkIn=08:05 state=Revised",
    `current=${JSON.stringify(row1b?.current)}`);

  // ulang putus dokumen sudah diputus → 409.
  const reDecide = await admin.api("PATCH", ADMIN_API, { id: id1, action: "approve" });
  ok(reDecide.status === 409, "putus ulang dokumen Approved → 409", `status=${reDecide.status}`);

  // ActivityLog approve memuat before→after.
  const logApp1 = await db.activityLog.findFirst({
    where: { entity: "AttendanceRegularizationRequest", entityId: docNo1, action: "Approved" },
  });
  ok(!!logApp1 && /in —|→/.test(logApp1.detail ?? ""), "ActivityLog approve memuat diff before→after", logApp1?.detail?.slice(0, 80) ?? "-");
  const logDaily = await db.activityLog.findFirst({
    where: { entity: "AttendanceDaily", entityId: docNo1 },
  });
  ok(!!logDaily, "ActivityLog mutasi AttendanceDaily tercatat");

  // ================= (5) admin reject (note wajib) =================
  console.log("\n[(5)] admin reject — note wajib ≥10 karakter");
  const reason2 = `${NONCE} jam tercatat salah karena device jam kaca mati`;
  const r2 = await ess.api("POST", ESS_API, {
    workDate: D2, kind: "WrongTime", clockIn: "08:15", clockOut: "17:45", reason: reason2,
  });
  const id2: string | undefined = r2.json?.id;
  const docNo2: string | undefined = r2.json?.docNo;
  ok(r2.status === 201 && !!id2, "submit WrongTime → 201", r2.json?.docNo ?? `status=${r2.status}`);

  const rejNoNote = await admin.api("PATCH", ADMIN_API, { id: id2, action: "reject" });
  ok(rejNoNote.status === 400 && /10 karakter/.test(rejNoNote.json?.error ?? ""),
    "reject tanpa note → 400", `status=${rejNoNote.status}`);
  const rejectNote = `Bukti clock tidak mendukung jam yang diajukan (${NONCE})`;
  const rej = await admin.api("PATCH", ADMIN_API, { id: id2, action: "reject", note: rejectNote });
  ok(rej.status === 200 && rej.json?.status === "Rejected", "reject dengan note → 200 Rejected", `status=${rej.status}`);

  const req2Db = await db.attendanceRegularizationRequest.findUnique({ where: { id: id2 } });
  ok(req2Db?.status === "Rejected" && req2Db.decisionNote === rejectNote, "DB: Rejected + decisionNote");

  const daily2 = await db.attendanceDaily.findUnique({
    where: { employeeId_workDate: { employeeId: yusuf.id, workDate: new Date(`${D2}T00:00:00`) } },
  });
  ok(!daily2 || daily2.state !== "Revised", "rekap tanggal reject TIDAK tersentuh (bukan Revised)",
    daily2 ? `state=${daily2.state}` : "tidak ada baris");

  // ================= (6) cap 4 aktif/bulan → 429 =================
  console.log("\n[(6)] cap D-BM7 — maks 4 aktif per bulan kalender");
  // (a) submit ke-1..4 (tanggal beda, bulan sama).
  const r3 = await ess.api("POST", ESS_API, {
    workDate: DC1, kind: "MissingClockOut", clockOut: "17:20", reason: `${NONCE} lembur selesai lupa clock out`,
  });
  ok(r3.status === 201, `submit aktif #1 (${DC1}) → 201`, r3.json?.docNo ?? `status=${r3.status}`);

  // (b) submit ke-2 dgn lampiran draf (upload ESS → rebind server).
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const draftEntityId = `draft:e2e-${Date.now()}`;
  const upForm = new FormData();
  upForm.append("entityType", "AttendanceRegularization");
  upForm.append("entityId", draftEntityId);
  upForm.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), `${NONCE}.png`);
  const upRes = await fetch(`${BASE}/api/rekankerja/attachments`, {
    method: "POST",
    headers: ess.cookie ? { cookie: ess.cookie } : {},
    body: upForm,
  });
  const upJson: any = await upRes.json().catch(() => ({}));
  ok(upRes.status === 201 && typeof upJson?.id === "string", "ESS upload draf lampiran (AttendanceRegularization)",
    `status=${upRes.status}`);
  const attId: string | undefined = upJson?.id;

  const r4 = await ess.api("POST", ESS_API, {
    workDate: DC2, kind: "MissingClockIn", clockIn: "07:55",
    reason: `${NONCE} masuk lewat gerbang belakang tanpa kiosk`,
    attachmentIds: attId ? [attId] : undefined,
  });
  ok(r4.status === 201, `submit aktif #2 + lampiran (${DC2}) → 201`, r4.json?.docNo ?? `status=${r4.status}`);
  const id4: string | undefined = r4.json?.id;
  if (attId && id4) {
    const attDb = await db.attachment.findUnique({ where: { id: attId } });
    ok(attDb?.entityType === "AttendanceRegularization" && attDb.entityId === id4,
      "lampiran draf ter-bind ke dokumen final", `entityId=${attDb?.entityId.slice(0, 12)}…`);
    const myListAtt = await ess.api("GET", ESS_API);
    const rowAtt = (myListAtt.json?.rows ?? []).find((r: any) => r.id === id4);
    ok(rowAtt?.attachmentCount === 1, "daftar ESS membawa attachmentCount=1");
  }

  const r5 = await ess.api("POST", ESS_API, {
    workDate: DC3, kind: "WrongTime", clockIn: "08:00", clockOut: "17:00",
    reason: `${NONCE} jam kiosk padam — tercatat salah satu jam`,
  });
  ok(r5.status === 201, `submit aktif #3 (${DC3}) → 201`, r5.json?.docNo ?? `status=${r5.status}`);
  const r6 = await ess.api("POST", ESS_API, {
    workDate: DC4, kind: "MissingBoth", clockIn: "21:00", clockOut: "05:00",
    reason: `${NONCE} shift malam — kedua jam tidak tercatat`,
  });
  ok(r6.status === 201, `submit aktif #4 MissingBoth lintas tengah malam (${DC4}) → 201`, r6.json?.docNo ?? `status=${r6.status}`);

  const myListCap = await ess.api("GET", ESS_API);
  ok(myListCap.json?.stats?.monthQuotaLeft === 0, "monthQuotaLeft ESS = 0 (4 aktif)",
    `quota=${myListCap.json?.stats?.monthQuotaLeft}`);

  // (c) submit ke-5 tanggal beda bulan sama → 429.
  const r7 = await ess.api("POST", ESS_API, {
    workDate: DC5, kind: "MissingClockOut", clockOut: "18:00",
    reason: `${NONCE} pengajuan kelima bulan yang sama`,
  });
  ok(r7.status === 429 && /4|Maksimal|maksimal/i.test(r7.json?.error ?? ""),
    "submit ke-5 bulan sama → 429 (cap 4 aktif)", `status=${r7.status} err=${r7.json?.error ?? ""}`);

  // ================= (7) ESS cancel own Submitted =================
  console.log("\n[(7)] ESS cancel own Submitted");
  const id3: string | undefined = r3.json?.id;
  const cancelRes = await ess.api("PATCH", ESS_API, { id: id3, note: `${NONCE} salah tanggal, tarik` });
  ok(cancelRes.status === 200 && cancelRes.json?.status === "Cancelled",
    "cancel own Submitted → 200 Cancelled", `status=${cancelRes.status}`);
  const chain3 = await db.approvalChain.findFirst({ where: { docType: "AttendanceReg", docId: id3 } });
  ok(chain3?.status === "Cancelled", "DB: chain Cancelled");
  const myListAfter = await ess.api("GET", ESS_API);
  ok(myListAfter.json?.stats?.monthQuotaLeft === 1, "kuota kembali 1 setelah cancel",
    `quota=${myListAfter.json?.stats?.monthQuotaLeft}`);

  const cancelAgain = await ess.api("PATCH", ESS_API, { id: id3, note: "ulang" });
  ok(cancelAgain.status === 409, "cancel ulang dokumen Cancelled → 409", `status=${cancelAgain.status}`);
  const cancelApproved = await ess.api("PATCH", ESS_API, { id: id1, note: "coba tarik yang sudah disetujui" });
  ok(cancelApproved.status === 409, "ESS cancel dokumen Approved → 409", `status=${cancelApproved.status}`);

  // ================= (8) guard akses lintas peran =================
  console.log("\n[(8)] guard akses");
  const essAsAdmin = await ess.api("GET", ADMIN_API);
  ok(essAsAdmin.status === 403, "sesi ESS → API admin → 403", `status=${essAsAdmin.status}`);

  // ================= (9) CLEANUP =================
  console.log("\n[(9)] CLEANUP — restore rekap + hapus artefak uji (ActivityLog DIPERTAHANKAN)");
  // restore AttendanceDaily D1 ke pra-uji (baris disentuh approve test).
  const daily1After = await db.attendanceDaily.findUnique({
    where: { employeeId_workDate: { employeeId: yusuf.id, workDate: new Date(`${D1}T00:00:00`) } },
  });
  if (priorRow && daily1After) {
    await db.attendanceDaily.update({
      where: { id: priorRow.id },
      data: {
        dayTypeId: priorRow.dayTypeId, state: priorRow.state, status: priorRow.status,
        presence: priorRow.presence, checkIn: priorRow.checkIn, checkOut: priorRow.checkOut,
        lateMinutes: priorRow.lateMinutes, earlyMinutes: priorRow.earlyMinutes,
        workMinutes: priorRow.workMinutes, normalMinutes: priorRow.normalMinutes,
        absenceMinutes: priorRow.absenceMinutes, overtimeMinutes: priorRow.overtimeMinutes,
        paidFlag: priorRow.paidFlag, notes: priorRow.notes,
        revised: priorRow.revised, revisedBy: priorRow.revisedBy,
      },
    });
    const restored = await db.attendanceDaily.findUnique({ where: { id: priorRow.id } });
    ok(restored?.state === priorRow.state && hhmmOf(restored?.checkIn?.toISOString() ?? null) === hhmmOf(priorRow.checkIn?.toISOString() ?? null),
      `AttendanceDaily ${D1} dikembalikan ke pra-uji`, `state=${restored?.state} in=${hhmmOf(restored?.checkIn?.toISOString() ?? null) ?? "—"}`);
  } else if (!priorRow && daily1After) {
    await db.attendanceDaily.delete({ where: { id: daily1After.id } });
    const gone = await db.attendanceDaily.findUnique({
      where: { employeeId_workDate: { employeeId: yusuf.id, workDate: new Date(`${D1}T00:00:00`) } },
    });
    ok(gone === null, `AttendanceDaily ${D1} (tidak ada pra-uji) dihapus`);
  } else {
    ok(true, `AttendanceDaily ${D1} tidak berubah (tidak tersentuh)`);
  }

  // hapus pengajuan uji + chain + notifikasi + lampiran.
  const testIds = [id1, id2, id3, id4, r5.json?.id, r6.json?.id].filter(Boolean) as string[];
  const testDocNos = [docNo1, docNo2, r3.json?.docNo, r4.json?.docNo, r5.json?.docNo, r6.json?.docNo].filter(Boolean) as string[];
  const delChain = await db.approvalChain.deleteMany({ where: { docType: "AttendanceReg", docId: { in: testIds } } });
  const delReq = await db.attendanceRegularizationRequest.deleteMany({ where: { id: { in: testIds } } });
  const delNotif = await db.notification.deleteMany({
    where: { OR: testDocNos.map((d) => ({ title: { contains: d } })) },
  });
  const delAtt = attId ? await db.attachment.deleteMany({ where: { id: attId } }) : { count: 0 };
  ok(delReq.count === testIds.length && delChain.count === testIds.length,
    "pengajuan uji + chain dihapus", `req=${delReq.count}/${testIds.length} chain=${delChain.count}/${testIds.length} notif=${delNotif.count} att=${delAtt.count}`);

  const arAfter = await db.attendanceRegularizationRequest.count();
  ok(arAfter === arBefore, "jumlah pengajuan kembali ke pra-uji", `${arAfter} vs ${arBefore}`);
  const dailyAfter = await db.attendanceDaily.count();
  ok(dailyAfter === dailyBefore, "jumlah AttendanceDaily kembali ke pra-uji", `${dailyAfter} vs ${dailyBefore}`);
  const logsKept = await db.activityLog.count({
    where: { entity: "AttendanceRegularizationRequest", entityId: { in: testDocNos } },
  });
  ok(logsKept >= testIds.length, "ActivityLog uji DIPERTAHANKAN (audit trail — pola B8)", `${logsKept} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
