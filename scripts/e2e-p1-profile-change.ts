// Uji E2E P1.1 (Fondasi data karyawan & ESS — DEVELOPMENT-PLAN-BENCHMARK.md
// §2 D-BM1/D-BM2/D-BM3/D-BM4 + §4 P1.1) — di atas data demo MII:
//   (0) SETUP: login HR owner hrd@mii.co.id + login ESS yusuf@mii.co.id;
//       snapshot field whitelist yusuf pra-uji (alamat/kota/email/telepon/
//       status pernikahan); pre-clean artefak run lama (PCR + kontak darurat
//       + notifikasi uji ber-marker).
//   (1) ESS submit UBAH ALAMAT → 201 + docNo PCR-YYYY-NNNN + before ditangkap
//       SERVER-SIDE (fieldsJson) + chain InProgress + muncul di register HR
//       (filter q + stats.submitted).
//   (2) FIELD MASTER ditolak: submit positionId (jabatan) → 400 + pesan
//       mengarah ke Personnel Action + daftar field yang diizinkan.
//   (3) NO-OP ditolak: nilai baru sama persis dgn nilai saat ini → 400.
//   (4) HR APPROVE FINAL → Employee.address TER-APPLY + ActivityLog
//       "Approved" entity ProfileChange memuat before→after + request
//       Approved + chain Approved + putus ulang → 409 (hanya Submitted).
//   (5) REJECT: submit ubah telepon → tolak TANPA catatan → 400 (wajib);
//       DENGAN catatan → 200 Rejected + telepon TIDAK berubah +
//       decisionNote tersimpan + ActivityLog "Rejected".
//   (6) CANCEL OWN: submit ubah kota → ESS batalkan sendiri → 200 Cancelled
//       + chain Cancelled + batalkan ulang → 409.
//   (7) KONTAK DARURAT via pengajuan: submit {kind:"contact", op:"add"} →
//       HR approve → EmergencyContact TERBUAT + telepon TERENKRIPSI at-rest
//       (enc:) + ter-DEKRIPSI di batas ESS & profil HR.
//   (8) GUARD: ESS akses register HR (GET/PATCH) → 403; entri kosong → 400;
//       kind tak dikenal → 400; id tak-ada → 404; aksi tak dikenal → 400.
//   (9) NOTIFIKASI in-app: submit → approver jenjang aktif (atasan yusuf =
//       hrd) menerima Notification ber-docNo (poll — notifyEvent fire-and-forget).
// CLEANUP: restore field yusuf ke pra-uji + hapus PCR uji + chain + kontak
//       darurat uji + notifikasi uji (ActivityLog DIPERTAHANKAN — audit
//       trail, pola B8).
// Jalankan: bun scripts/e2e-p1-profile-change.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const ESS_EMAIL = "yusuf@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const HR_API = "/api/rekankerja/hr/profile-changes";
const ESS_API = "/api/rekankerja/ess/profile-changes";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) — pola e2e-b8.
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

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const ess = new Sesi();
  const startedAt = new Date();
  const NONCE = `E2E-P11-${Date.now().toString(36).toUpperCase()}`;
  const createdDocNos: string[] = [];
  const createdPcrIds: string[] = [];

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + snapshot field whitelist yusuf + pre-clean");
  const loginHr = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(loginHr.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${loginHr.status}`);
  const loginEss = await ess.api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(loginEss.status === 200, `login ESS ${ESS_EMAIL}`, `HTTP ${loginEss.status}`);

  const yusuf = await db.employee.findFirst({
    where: { fullName: { contains: "Yusuf" } },
    select: {
      id: true, employeeNo: true, fullName: true,
      address: true, city: true, email: true, phone: true, maritalStatus: true,
    },
  });
  ok(!!yusuf, "karyawan ESS yusuf ditemukan", yusuf?.employeeNo ?? "—");
  const ORIG = {
    address: yusuf?.address ?? null,
    city: yusuf?.city ?? null,
    email: yusuf?.email ?? null,
    phone: yusuf?.phone ?? null,
    maritalStatus: yusuf?.maritalStatus ?? null,
  };

  // pre-clean run lama: PCR ber-marker + chain-nya + kontak darurat uji + notifikasi uji
  const stalePcr = await db.employeeProfileChangeRequest.findMany({
    where: { reason: { contains: "E2E-P11-" } },
    select: { id: true },
  });
  for (const s of stalePcr) {
    await db.approvalChain.deleteMany({ where: { docType: "ProfileChange", docId: s.id } }).catch(() => {});
    await db.employeeProfileChangeRequest.deleteMany({ where: { id: s.id } }).catch(() => {});
  }
  const staleEc = await db.emergencyContact.deleteMany({ where: { name: { contains: "E2e P11" } } });
  const staleNotif = await db.notification.deleteMany({
    where: { OR: [
      { body: { contains: "E2E-P11-" } },
      { AND: [{ title: { contains: "PCR-" } }, { title: { contains: "Pengajuan ubah data" } }] },
    ] },
  });
  if (stalePcr.length > 0 || staleEc.count > 0 || staleNotif.count > 0) {
    console.log(`  pre-clean: ${stalePcr.length} PCR + ${staleEc.count} kontak + ${staleNotif.count} notifikasi run lama dihapus`);
  }
  const pcrBefore = await db.employeeProfileChangeRequest.count();

  // ================= (1) ESS SUBMIT UBAH ALAMAT =================
  console.log("\n[(1)] ESS — submit ubah alamat (D-BM1: pengajuan, bukan tulis langsung)");
  const NEW_ADDR = `Jl. E2E P11 No. ${NONCE.slice(-5)}, Bogor`;
  const essGet0 = await ess.api("GET", ESS_API);
  ok(essGet0.status === 200, "GET ess/profile-changes (prefill) → 200", `HTTP ${essGet0.status}`);
  ok(essGet0.json?.current?.address === ORIG.address, "GET memuat nilai saat ini (address prefill)", `${essGet0.json?.current?.address ?? "—"}`);

  const sub1 = await ess.api("POST", ESS_API, {
    entries: [{ kind: "field", field: "address", after: NEW_ADDR }],
    reason: `${NONCE} pindah rumah (uji)`,
  });
  ok(sub1.status === 201, "POST submit ubah alamat → 201", `HTTP ${sub1.status} — ${sub1.json?.docNo ?? sub1.json?.error}`);
  const docNo1: string = sub1.json?.docNo ?? "";
  ok(/^PCR-\d{4}-\d{4}$/.test(docNo1), "docNo format PCR-YYYY-NNNN (retryOnUnique)", docNo1);
  createdDocNos.push(docNo1);

  const row1 = await db.employeeProfileChangeRequest.findFirst({
    where: { docNo: docNo1 },
    select: { id: true, status: true, fieldsJson: true, reason: true },
  });
  ok(!!row1, "row tersimpan di db");
  createdPcrIds.push(row1?.id ?? "");
  ok(row1?.status === "Submitted", "status awal Submitted", row1?.status);
  const entries1 = JSON.parse(row1?.fieldsJson ?? "[]");
  ok(entries1.length === 1 && entries1[0]?.field === "address", "fieldsJson memuat 1 entri address");
  ok(entries1[0]?.before === ORIG.address, "BEFORE ditangkap SERVER-SIDE (bukan dari klien)", `${entries1[0]?.before}`);
  ok(entries1[0]?.after === NEW_ADDR, "AFTER = nilai baru yang diajukan");
  const chain1 = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: "ProfileChange", docId: row1!.id } },
    select: { status: true, currentLevel: true, totalLevels: true },
  });
  ok(chain1?.status === "InProgress" && chain1.totalLevels >= 1, "chain approval dibuat (docType ProfileChange)", `L${chain1?.currentLevel}/${chain1?.totalLevels} ${chain1?.status}`);
  const logSub1 = await db.activityLog.findFirst({
    where: { entity: "ProfileChange", entityId: docNo1, action: "Submitted" },
    select: { detail: true },
  });
  ok(!!logSub1, "ActivityLog Submitted tertulis");

  // register HR memuat pengajuan
  const hrList1 = await hr.api("GET", `${HR_API}?status=Submitted&q=${encodeURIComponent(docNo1)}`);
  ok(hrList1.status === 200, "GET register HR → 200", `HTTP ${hrList1.status}`);
  const hrRows1: any[] = hrList1.json?.rows ?? [];
  const hrRow1 = hrRows1.find((r) => r.docNo === docNo1);
  ok(!!hrRow1, "pengajuan MUNCUL di register HR (filter q)", `${hrRows1.length} baris`);
  ok(hrRow1?.employee?.employeeNo === yusuf?.employeeNo, "kolom karyawan = yusuf", `${hrRow1?.employee?.fullName ?? "—"}`);
  ok(hrRow1?.approval?.currentApprover != null, "ringkasan chain menampilkan approver aktif", hrRow1?.approval?.currentApprover ?? "—");
  ok((hrList1.json?.stats?.submitted ?? 0) >= 1, "stats.submitted ≥ 1 (badge menunggu)");

  // ================= (2) FIELD MASTER DITOLAK 400 =================
  console.log("\n[(2)] GUARD WHITELIST — field master (positionId) → 400 + arahan PA");
  const subMaster = await ess.api("POST", ESS_API, {
    entries: [{ kind: "field", field: "positionId", after: "pos-lain" }],
    reason: `${NONCE} coba ubah jabatan`,
  });
  ok(subMaster.status === 400, "submit field master positionId → 400", `HTTP ${subMaster.status}`);
  ok(
    typeof subMaster.json?.error === "string" && subMaster.json.error.includes("Personnel Action"),
    "pesan 400 mengarah ke Personnel Action",
    String(subMaster.json?.error ?? "").slice(0, 90),
  );
  ok(
    typeof subMaster.json?.error === "string" && subMaster.json.error.includes("address"),
    "pesan 400 mencantumkan daftar field yang diizinkan",
  );
  const subSalary = await ess.api("POST", ESS_API, {
    entries: [{ kind: "field", field: "baseSalary", after: "99999999" }],
    reason: `${NONCE} coba ubah gaji`,
  });
  ok(subSalary.status === 400, "submit field gaji baseSalary → 400 (wajib PA)", `HTTP ${subSalary.status}`);

  // ================= (3) NO-OP DITOLAK =================
  console.log("\n[(3)] NO-OP — nilai sama persis dgn nilai saat ini → 400");
  const subNoop = await ess.api("POST", ESS_API, {
    entries: [{ kind: "field", field: "address", after: ORIG.address ?? "" }],
    reason: `${NONCE} tanpa perubahan`,
  });
  ok(subNoop.status === 400, "submit tanpa perubahan efektif → 400", `HTTP ${subNoop.status}`);

  // ================= (4) HR APPROVE FINAL → PATCH OTOMATIS =================
  console.log("\n[(4)] HR — approve final: patch otomatis ke Employee + ActivityLog before→after");
  const appr1 = await hr.api("PATCH", HR_API, { id: row1!.id, action: "approve", note: "Sesuai domisili baru" });
  ok(appr1.status === 200 && appr1.json?.status === "Approved", "PATCH approve → 200 Approved", `HTTP ${appr1.status} — ${appr1.json?.status ?? appr1.json?.error}`);
  const empAfter = await db.employee.findUnique({
    where: { id: yusuf!.id },
    select: { address: true },
  });
  ok(empAfter?.address === NEW_ADDR, "Employee.address TER-APPLY via patch otomatis", `${empAfter?.address}`);
  const row1b = await db.employeeProfileChangeRequest.findUnique({
    where: { id: row1!.id },
    select: { status: true, decidedAt: true, decidedById: true, decisionNote: true },
  });
  ok(row1b?.status === "Approved" && row1b.decidedAt != null, "request Approved + decidedAt terisi");
  const chain1b = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: "ProfileChange", docId: row1!.id } },
    select: { status: true },
  });
  ok(chain1b?.status === "Approved", "chain approval Approved (jenjang selesai)");
  const logApp1 = await db.activityLog.findFirst({
    where: { entity: "ProfileChange", entityId: docNo1, action: "Approved" },
    select: { detail: true },
  });
  ok(!!logApp1, "ActivityLog Approved tertulis");
  ok(
    !!logApp1?.detail && logApp1.detail.includes("→") && logApp1.detail.toLowerCase().includes("dissetujui"),
    "detail ActivityLog memuat rincian before→after per field",
    (logApp1?.detail ?? "").slice(0, 110),
  );
  // putus ulang → 409 (hanya Submitted)
  const apprAgain = await hr.api("PATCH", HR_API, { id: row1!.id, action: "approve" });
  ok(apprAgain.status === 409, "putus ulang pengajuan sudah diputus → 409", `HTTP ${apprAgain.status}`);

  // ================= (5) REJECT + CATATAN =================
  console.log("\n[(5)] HR — reject: catatan wajib + data TIDAK berubah");
  const NEW_PHONE = `08${Date.now().toString().slice(-10)}`;
  const sub2 = await ess.api("POST", ESS_API, {
    entries: [{ kind: "field", field: "phone", after: NEW_PHONE }],
    reason: `${NONCE} ganti nomor (uji tolak)`,
  });
  ok(sub2.status === 201, "submit ubah telepon → 201", sub2.json?.docNo ?? "");
  const row2 = await db.employeeProfileChangeRequest.findFirst({
    where: { docNo: sub2.json?.docNo },
    select: { id: true },
  });
  createdPcrIds.push(row2?.id ?? "");
  createdDocNos.push(sub2.json?.docNo ?? "");
  const rejNoNote = await hr.api("PATCH", HR_API, { id: row2!.id, action: "reject", note: "" });
  ok(rejNoNote.status === 400, "reject TANPA catatan → 400 (wajib)", `HTTP ${rejNoNote.status}`);
  const rejNote = await hr.api("PATCH", HR_API, { id: row2!.id, action: "reject", note: "Nomor tidak bisa diverifikasi" });
  ok(rejNote.status === 200 && rejNote.json?.status === "Rejected", "reject DENGAN catatan → 200 Rejected", `HTTP ${rejNote.status}`);
  const empPhone = await db.employee.findUnique({ where: { id: yusuf!.id }, select: { phone: true } });
  ok(empPhone?.phone === ORIG.phone, "telepon TIDAK berubah (patch tidak diterapkan)", `${empPhone?.phone}`);
  const row2b = await db.employeeProfileChangeRequest.findUnique({
    where: { id: row2!.id },
    select: { status: true, decisionNote: true },
  });
  ok(row2b?.status === "Rejected" && row2b.decisionNote === "Nomor tidak bisa diverifikasi", "status Rejected + catatan keputusan tersimpan");
  const logRej2 = await db.activityLog.findFirst({
    where: { entity: "ProfileChange", entityId: sub2.json?.docNo, action: "Rejected" },
    select: { detail: true },
  });
  ok(!!logRej2 && !!logRej2.detail?.includes("Nomor tidak bisa diverifikasi"), "ActivityLog Rejected memuat alasan");

  // ================= (6) CANCEL OWN (ESS) =================
  console.log("\n[(6)] ESS — batalkan pengajuan sendiri selama Submitted");
  const NEW_CITY = `Kota E2E ${NONCE.slice(-5)}`;
  const sub3 = await ess.api("POST", ESS_API, {
    entries: [{ kind: "field", field: "city", after: NEW_CITY }],
    reason: `${NONCE} pindah kota (uji batal)`,
  });
  ok(sub3.status === 201, "submit ubah kota → 201", sub3.json?.docNo ?? "");
  const row3 = await db.employeeProfileChangeRequest.findFirst({
    where: { docNo: sub3.json?.docNo },
    select: { id: true },
  });
  createdPcrIds.push(row3?.id ?? "");
  createdDocNos.push(sub3.json?.docNo ?? "");
  const cancel1 = await ess.api("PATCH", ESS_API, { id: row3!.id });
  ok(cancel1.status === 200, "PATCH cancel (milik sendiri, Submitted) → 200", `HTTP ${cancel1.status}`);
  const row3b = await db.employeeProfileChangeRequest.findUnique({
    where: { id: row3!.id },
    select: { status: true },
  });
  ok(row3b?.status === "Cancelled", "status Cancelled");
  const chain3 = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: "ProfileChange", docId: row3!.id } },
    select: { status: true },
  });
  ok(chain3?.status === "Cancelled", "chain ikut dibatalkan");
  const empCity = await db.employee.findUnique({ where: { id: yusuf!.id }, select: { city: true } });
  ok(empCity?.city === ORIG.city, "kota TIDAK berubah (dibatalkan sebelum diputus)");
  const cancelAgain = await ess.api("PATCH", ESS_API, { id: row3!.id });
  ok(cancelAgain.status === 409, "batalkan ulang pengajuan sudah berakhir → 409", `HTTP ${cancelAgain.status}`);

  // ================= (7) KONTAK DARURAT VIA PENGAJUAN =================
  console.log("\n[(7)] KONTAK DARURAT — add via pengajuan → ter-apply terenkripsi saat approve");
  const EC_NAME = `E2e P11 Kontak ${NONCE.slice(-6)}`;
  const EC_PHONE = "089876543210";
  const sub4 = await ess.api("POST", ESS_API, {
    entries: [{ kind: "contact", op: "add", name: EC_NAME, relationship: "Saudara", phone: EC_PHONE, isPrimary: false }],
    reason: `${NONCE} tambah kontak darurat`,
  });
  ok(sub4.status === 201, "submit kontak darurat add → 201", sub4.json?.docNo ?? "");
  const row4 = await db.employeeProfileChangeRequest.findFirst({
    where: { docNo: sub4.json?.docNo },
    select: { id: true, fieldsJson: true },
  });
  createdPcrIds.push(row4?.id ?? "");
  createdDocNos.push(sub4.json?.docNo ?? "");
  const entries4 = JSON.parse(row4?.fieldsJson ?? "[]");
  ok(entries4[0]?.kind === "contact" && entries4[0]?.op === "add" && entries4[0]?.after?.name === EC_NAME, "fieldsJson memuat entri contact add");
  const appr4 = await hr.api("PATCH", HR_API, { id: row4!.id, action: "approve", note: null });
  ok(appr4.status === 200 && appr4.json?.status === "Approved", "HR approve pengajuan kontak → 200 Approved", `HTTP ${appr4.status}`);
  const ecRow = await db.emergencyContact.findFirst({
    where: { employeeId: yusuf!.id, name: EC_NAME },
    select: { id: true, phone: true, relationship: true, isPrimary: true },
  });
  ok(!!ecRow, "EmergencyContact TERBUAT saat approve final");
  ok(!!ecRow?.phone?.startsWith("enc:"), "telepon TERENKRIPSI at-rest (enc:…)", `${ecRow?.phone?.slice(0, 18)}…`);
  ok(ecRow?.relationship === "Saudara" && ecRow.isPrimary === false, "hubungan + prioritas tersimpan");
  // dekripsi di batas: ESS GET (self-scope) + register kontak darurat admin
  // (family.ts kind=emergency — gerbang menu-view karena PII nomor telepon).
  const essGet2 = await ess.api("GET", ESS_API);
  const essContacts: any[] = essGet2.json?.contacts ?? [];
  const essEc = essContacts.find((c) => c.name === EC_NAME);
  ok(essEc?.phone === EC_PHONE, "ESS melihat telepon TERDEKRIPSI di batas serializer", `${essEc?.phone}`);
  const famR = await hr.api("GET", `/api/rekankerja/family?kind=emergency&employeeId=${yusuf!.id}`);
  const famContacts: any[] = famR.json?.contacts ?? [];
  const famEc = famContacts.find((c: any) => c.name === EC_NAME);
  ok(famR.status === 200 && famEc?.phone === EC_PHONE, "register kontak darurat admin (family kind=emergency) → telepon didekripsi di batas", `HTTP ${famR.status}`);
  // privasi PII pihak ketiga: pemanggil LIMITED (hrd = atasan langsung yusuf,
  // dibatasi company aktif) TIDAK melihat kontak darurat via employee-detail.
  const detailR = await hr.api("GET", `/api/rekankerja/employee-detail?id=${yusuf!.id}`);
  ok(
    detailR.status === 200 && detailR.json?.piiScope === "limited"
      && ((detailR.json?.employee?.emergencyContacts ?? []) as any[]).length === 0,
    "employee-detail pemanggil limited → emergencyContacts KOSONG (PII pihak ketiga dijaga)",
    `piiScope=${detailR.json?.piiScope}`,
  );

  // ================= (8) GUARD =================
  console.log("\n[(8)] GUARD — 403/404/400");
  const gEssList = await ess.api("GET", HR_API);
  ok(gEssList.status === 403, "ESS GET register HR → 403 (menu-guard)", `HTTP ${gEssList.status}`);
  const gEssDecide = await ess.api("PATCH", HR_API, { id: row1!.id, action: "approve" });
  ok(gEssDecide.status === 403, "ESS PATCH keputusan HR → 403", `HTTP ${gEssDecide.status}`);
  const gEmpty = await ess.api("POST", ESS_API, { entries: [], reason: NONCE });
  ok(gEmpty.status === 400, "entries kosong → 400 (minimal 1 perubahan)", `HTTP ${gEmpty.status}`);
  const gKind = await ess.api("POST", ESS_API, { entries: [{ kind: "haha", field: "address", after: "x" }], reason: NONCE });
  ok(gKind.status === 400, "kind tak dikenal → 400", `HTTP ${gKind.status}`);
  const gNoId = await hr.api("PATCH", HR_API, { id: "tidak-ada-xyz", action: "approve" });
  ok(gNoId.status === 404, "HR putus id tak-ada → 404", `HTTP ${gNoId.status}`);
  const gBadAction = await hr.api("PATCH", HR_API, { id: row1!.id, action: "apa-aja" });
  ok(gBadAction.status === 400, "aksi tak dikenal → 400", `HTTP ${gBadAction.status}`);
  const gOtherContact = await ess.api("POST", ESS_API, {
    entries: [{ kind: "contact", op: "remove", contactId: "bukan-milik" }],
    reason: NONCE,
  });
  ok(gOtherContact.status === 404, "ubah/hapus kontak TIDAK milik sendiri → 404", `HTTP ${gOtherContact.status}`);

  // ================= (9) NOTIFIKASI IN-APP (fire-and-forget → poll) =================
  console.log("\n[(9)] NOTIFIKASI — submit → approver jenjang aktif menerima in-app notify");
  let notifFound = false;
  for (let i = 0; i < 10 && !notifFound; i++) {
    const n = await db.notification.findFirst({
      where: { title: { contains: docNo1 }, createdAt: { gte: startedAt } },
      select: { id: true, title: true },
    });
    if (n) { notifFound = true; break; }
    await new Promise((r) => setTimeout(r, 800));
  }
  ok(notifFound, "Notification utk approver (title memuat docNo submit #1) diterima", docNo1);

  // ================= (10) CLEANUP =================
  console.log("\n[(10)] CLEANUP — restore field yusuf + hapus artefak uji (ActivityLog DIPERTAHANKAN)");
  await db.employee.update({
    where: { id: yusuf!.id },
    data: {
      address: ORIG.address, city: ORIG.city, email: ORIG.email,
      phone: ORIG.phone, maritalStatus: ORIG.maritalStatus,
    },
  });
  const empRestored = await db.employee.findUnique({
    where: { id: yusuf!.id },
    select: { address: true, city: true, phone: true },
  });
  ok(
    empRestored?.address === ORIG.address && empRestored.city === ORIG.city && empRestored.phone === ORIG.phone,
    "field whitelist yusuf dikembalikan ke pra-uji",
  );
  // PCR uji + chain + kontak darurat uji + notifikasi uji
  const delPcr = await db.employeeProfileChangeRequest.deleteMany({
    where: { id: { in: createdPcrIds.filter(Boolean) } },
  });
  const delChain = await db.approvalChain.deleteMany({
    where: { docType: "ProfileChange", docId: { in: createdPcrIds.filter(Boolean) } },
  });
  const delEc = await db.emergencyContact.deleteMany({ where: { name: EC_NAME } });
  const delNotif = await db.notification.deleteMany({
    where: { OR: [
      { body: { contains: NONCE } },
      { title: { contains: "PCR-" , } },
    ] },
  });
  ok(
    delPcr.count === createdPcrIds.filter(Boolean).length && delChain.count >= 1 && delEc.count === 1,
    "PCR uji + chain + kontak darurat uji dihapus",
    `pcr=${delPcr.count} chain=${delChain.count} ec=${delEc.count} notif=${delNotif.count}`,
  );
  const pcrFinal = await db.employeeProfileChangeRequest.count();
  ok(pcrFinal === pcrBefore, "jumlah PCR kembali ke pra-uji", `${pcrFinal} vs ${pcrBefore}`);
  const ecLeft = await db.emergencyContact.count({ where: { name: { contains: "E2e P11" } } });
  ok(ecLeft === 0, "kontak darurat uji bersih");
  const logsKept = await db.activityLog.count({
    where: { entity: "ProfileChange", entityId: { in: createdDocNos } },
  });
  ok(logsKept >= 6, "ActivityLog uji DIPERTAHANKAN (audit trail — pola B8)", `${logsKept} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
