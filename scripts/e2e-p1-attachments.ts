// P1.2-BM (D-BM5/D-BM6) — E2E lampiran & bukti (local dev :3000):
//   1) gate needDocs: cuti CT-SAKIT TANPA lampiran → 400 (jalur admin DAN ESS)
//   2) CT-SAKIT DENGAN lampiran (upload draf via ESS → submit) → 201 +
//      lampiran ter-bound (verifikasi GET admin + GET ESS)
//   2b) guard: submit dgn attachmentIds palsu → 400 "Lampiran tidak valid"
//   3) CT-THN (tanpa needDocs) submit tanpa lampiran → 201 tetap jalan
//   4) klaim medis ESS dengan foto struk → 201 + ter-bound → cleanup cancel
//   5) guard kepemilikan: ESS unggah lampiran LeaveRequest utk permintaan
//      karyawan LAIN (id final) → 403
// Cleanup: semua request cuti & klaim uji dibatalkan di akhir.
// Jalankan: bun scripts/e2e-p1-attachments.ts  (server dev di :3000)
export {};
const BASE = "http://localhost:3000";
const ADMIN = { email: "hrd@mii.co.id", password: "onevity123" };
const ESS = { email: "yusuf@mii.co.id", password: "EssDemo123!" };

/** cookie per sesi (admin / ess) — swap saat ganti aktor. */
const cookies: Record<"admin" | "ess", string> = { admin: "", ess: "" };
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
};

async function login(role: "admin" | "ess"): Promise<void> {
  const res = await fetchRetry(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(role === "admin" ? ADMIN : ESS),
  });
  const j = await res.json().catch(() => ({}));
  ok(`login ${role}`, res.status === 200, `status=${res.status}`);
  if (res.status !== 200) {
    console.error(JSON.stringify(j));
    process.exit(1);
  }
  const sc = res.headers.get("set-cookie");
  if (sc) cookies[role] = sc.split(";")[0] ?? "";
}

/** fetch + retry ringan (dev server bisa restart saat paralel-agent lintas proses). */
async function fetchRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function api(
  role: "admin" | "ess",
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetchRetry(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookies[role] ? { cookie: cookies[role] } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** unggah draf lampiran (multipart) sebagai sesi tertentu. */
async function uploadDraft(
  role: "admin" | "ess",
  entityType: "LeaveRequest" | "MedicalClaim",
  entityId: string,
  fileName: string,
): Promise<{ status: number; id?: string }> {
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const form = new FormData();
  form.append("entityType", entityType);
  form.append("entityId", entityId);
  form.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), fileName);
  const res = await fetchRetry(`${BASE}/api/rekankerja/attachments`, {
    method: "POST",
    headers: cookies[role] ? { cookie: cookies[role] } : {},
    body: form,
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, id: typeof j?.id === "string" ? j.id : undefined };
}

const json = async (r: Response): Promise<any> => r.json().catch(() => ({}));
const stamp = Date.now().toString().slice(-6);
const today = new Date().toISOString().slice(0, 10);
// satu hari kerja ±60 hari ke depan (hindari bentrok pengajuan demo lama)
const far = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);

await login("admin");
await login("ess");

// ===== master jenis cuti (admin) =====
const typesRes = await api("admin", "GET", "/api/rekankerja/leave/types");
const typesJ = await json(typesRes);
const types: { id: string; code: string; name: string; needDocs: boolean; noticeDays: number }[] = typesJ?.types ?? [];
const sakit = types.find((t) => t.code === "CT-SAKIT");
const thn = types.find((t) => t.code === "CT-THN");
ok("master jenis cuti termuat", typesRes.status === 200 && !!sakit && !!thn, `${types.length} jenis`);
if (!sakit || !thn) process.exit(1);
ok("CT-SAKIT needDocs=true (D-BM5)", sakit.needDocs === true);
ok("CT-THN needDocs=false", thn.needDocs === false);

// karyawan uji admin = karyawan pertama yang aktif (bukan yusuf — utk uji
// kepemilikan lintas karyawan di skenario 5)
const optRes = await api("admin", "GET", "/api/rekankerja/employee-options");
const optJ = await json(optRes);
const employees: { id: string; name: string }[] = (optJ?.managers ?? []).map(
  (e: { id: string; name?: string; fullName?: string }) => ({ id: e.id, name: e.name ?? e.fullName ?? "?" }),
);
ok("employee-options", optRes.status === 200 && employees.length > 0, `${employees.length} karyawan`);
if (employees.length === 0) process.exit(1);

// id karyawan yusuf (pemilik sesi ESS) — dari GET ESS leave (requests miliknya)
const essLeave0 = await json(await api("ess", "GET", "/api/rekankerja/ess/leave"));
const essBalances: { typeId: string; code: string; name: string; available: number; needDocs?: boolean }[] = essLeave0?.balances ?? [];
const essSakit = essBalances.find((b) => b.code === "CT-SAKIT");
ok("ESS GET leave (form CT-SAKIT terlihat)", essLeave0 && !!essSakit, `sakit sisa=${essSakit?.available ?? "?"}`);

// ===== 1a) gate needDocs jalur ADMIN: CT-SAKIT tanpa lampiran → 400 =====
const g1 = await api("admin", "POST", "/api/rekankerja/leave/requests", {
  employeeId: employees[0]!.id, leaveTypeId: sakit.id,
  dateFrom: far, sessionFrom: "AM", dateTo: far, sessionTo: "PM",
  reason: "E2E P1.2 gate needDocs admin — tanpa lampiran",
});
const g1j = await json(g1);
ok("1a) admin CT-SAKIT tanpa lampiran → 400", g1.status === 400, `status=${g1.status} err=${String(g1j?.error ?? "").slice(0, 90)}`);
ok("1a) pesan menyebut nama jenis cuti", typeof g1j?.error === "string" && g1j.error.includes(sakit.name), g1j?.error ?? "");

// ===== 1b) gate needDocs jalur ESS: CT-SAKIT tanpa lampiran → 400 =====
const g2 = await api("ess", "POST", "/api/rekankerja/ess/leave", {
  typeId: essSakit!.typeId, dateFrom: far, dateTo: far, halfDay: false,
  reason: "E2E P1.2 gate needDocs ESS — tanpa lampiran",
});
const g2j = await json(g2);
ok("1b) ESS CT-SAKIT tanpa lampiran → 400", g2.status === 400, `status=${g2.status} err=${String(g2j?.error ?? "").slice(0, 90)}`);

// ===== 2) CT-SAKIT dengan lampiran via ESS → 201 + ter-bind =====
const draft1 = await uploadDraft("ess", "LeaveRequest", `draft:e2e-p12-${stamp}`, `skd-e2e-${stamp}.png`);
ok("2) ESS upload draf lampiran LeaveRequest", draft1.status === 201, `status=${draft1.status}`);
const s2 = await api("ess", "POST", "/api/rekankerja/ess/leave", {
  typeId: essSakit!.typeId, dateFrom: far, dateTo: far, halfDay: false,
  reason: `E2E P1.2 lampiran SKD ${stamp}`,
  attachmentIds: draft1.id ? [draft1.id] : [],
});
const s2j = await json(s2);
ok("2) ESS CT-SAKIT dengan lampiran → 201", s2.status === 201, `status=${s2.status} doc=${s2j?.docNo ?? "?"}`);
ok("2) response memuat attachmentCount=1", s2j?.attachmentCount === 1, `count=${s2j?.attachmentCount ?? "?"}`);
const createdDoc = String(s2j?.docNo ?? "");

// verifikasi ter-bound: GET admin (daftar + metadata lampiran)
const listRes = await api("admin", "GET", "/api/rekankerja/leave/requests?status=Submitted");
const listJ = await json(listRes);
const row = (listJ?.requests ?? []).find((r: { docNo: string }) => r.docNo === createdDoc);
ok("2) GET admin menemukan baris baru", !!row, `doc=${createdDoc}`);
ok("2) lampiran ter-bound di baris (attachmentCount=1)", row?.attachmentCount === 1 && Array.isArray(row?.attachments) && row.attachments.length === 1, `count=${row?.attachmentCount ?? "?"} file=${row?.attachments?.[0]?.fileName ?? "?"}`);
ok("2) metadata lampiran (id/fileName/size/mime)", !!row?.attachments?.[0]?.id && !!row?.attachments?.[0]?.fileName && typeof row?.attachments?.[0]?.sizeBytes === "number" && !!row?.attachments?.[0]?.mimeType);

// verifikasi sisi ESS: riwayat "Cuti Saya" memuat jumlah lampiran
const essAfter = await json(await api("ess", "GET", "/api/rekankerja/ess/leave"));
const essRow = (essAfter?.requests ?? []).find((r: { docNo: string }) => r.docNo === createdDoc);
ok("2) GET ESS riwayat memuat attachmentCount=1", essRow?.attachmentCount === 1, `count=${essRow?.attachmentCount ?? "?"}`);

// ===== 2b) guard: attachmentIds palsu → 400 "Lampiran tidak valid" =====
const g3 = await api("admin", "POST", "/api/rekankerja/leave/requests", {
  employeeId: employees[0]!.id, leaveTypeId: sakit.id,
  dateFrom: far, sessionFrom: "AM", dateTo: far, sessionTo: "PM",
  reason: "E2E P1.2 attachmentIds palsu",
  attachmentIds: ["att_tidak-ada-xyz"],
});
ok("2b) admin CT-SAKIT dgn attachmentIds palsu → 400", g3.status === 400, `status=${g3.status}`);

// ===== 3) CT-THN tanpa needDocs → 201 tanpa lampiran =====
// pilih karyawan admin yang masih punya saldo (preview dulu; fallback karyawan pertama)
let thnEmp = employees[0]!;
for (const e of employees.slice(0, 10)) {
  const pv = await json(await api("admin", "POST", "/api/rekankerja/leave/requests", {
    employeeId: e.id, leaveTypeId: thn.id, dateFrom: far, sessionFrom: "AM", dateTo: far, sessionTo: "PM",
    reason: "preview", preview: true,
  }));
  if (pv?.remaining != null && pv.remaining >= 1) { thnEmp = e; break; }
}
const s3 = await api("admin", "POST", "/api/rekankerja/leave/requests", {
  employeeId: thnEmp.id, leaveTypeId: thn.id,
  dateFrom: far, sessionFrom: "AM", dateTo: far, sessionTo: "PM",
  reason: `E2E P1.2 tanpa gate (CT-THN) ${stamp}`,
});
const s3j = await json(s3);
ok("3) admin CT-THN tanpa lampiran → 201", s3.status === 201, `status=${s3.status} doc=${s3j?.docNo ?? "?"}`);
const thnDoc = String(s3j?.docNo ?? "");

// ===== 4) klaim medis ESS dengan foto struk → 201 + ter-bound =====
const medForm = await json(await api("ess", "GET", "/api/rekankerja/ess/claims/medical"));
const medTypes: { typeId: string; name: string; remainingForClaim: number; limitRule: string; needReceipt: boolean }[] = medForm?.types ?? [];
const medType = medTypes.find((t) => t.limitRule === "UNLIMITED") ?? medTypes.find((t) => (t.remainingForClaim ?? 0) >= 50000) ?? medTypes[0];
ok("4) ESS form klaim medis termuat", medForm && !!medType, `jenis=${medType?.name ?? "?"}`);
const draft2 = await uploadDraft("ess", "MedicalClaim", `draft:e2e-p12m-${stamp}`, `struk-e2e-${stamp}.png`);
ok("4) ESS upload draf foto struk (MedicalClaim)", draft2.status === 201, `status=${draft2.status}`);
const s4 = await api("ess", "POST", "/api/rekankerja/ess/claims/medical", {
  typeId: medType?.typeId,
  claimDate: today,
  note: `E2E P1.2 struk ${stamp}`,
  attachmentIds: draft2.id ? [draft2.id] : [],
  lines: [{
    treatedName: "Yusuf Rahayu",
    treatment: "E2E rawat jalan (P1.2)",
    treatmentDate: today,
    receiptNo: `E2E-P12-${stamp}`,
    physician: "dr. E2E",
    hospital: "Klinik E2E",
    billAmount: 25000,
  }],
});
const s4j = await json(s4);
ok("4) ESS klaim medis dengan struk → 201", s4.status === 201, `status=${s4.status} doc=${s4j?.docNo ?? "?"}`);
ok("4) response attachmentCount=1 + receiptNote baru", s4j?.attachmentCount === 1 && typeof s4j?.receiptNote === "string", `count=${s4j?.attachmentCount ?? "?"} note=${String(s4j?.receiptNote ?? "").slice(0, 60)}`);
const medDoc = String(s4j?.docNo ?? "");
const medId = String(s4j?.id ?? "");

// verifikasi ter-bound via admin (badge + metadata di daftar klaim)
const medList = await json(await api("admin", "GET", "/api/rekankerja/medical/claims"));
const medRow = (medList?.claims ?? []).find((c: { docNo: string }) => c.docNo === medDoc);
ok("4) admin melihat lampiran pada klaim (attachmentCount=1)", medRow?.attachmentCount === 1 && (medRow?.attachments ?? []).length === 1, `doc=${medDoc}`);

// ===== 5) guard kepemilikan: ESS unggah utk permintaan karyawan LAIN → 403 =====
// ambil permintaan cuti milik karyawan lain (id final) dari daftar admin
const otherReq = (listJ?.requests ?? []).find((r: { id: string; docNo: string }) => r.docNo !== createdDoc) ??
  (await json(await api("admin", "GET", "/api/rekankerja/leave/requests?status=all"))).requests?.[0];
if (otherReq?.id) {
  const hijack = await uploadDraft("ess", "LeaveRequest", otherReq.id, `bocor-e2e-${stamp}.png`);
  ok("5) ESS unggah lampiran utk permintaan orang lain → 403", hijack.status === 403, `status=${hijack.status}`);
} else {
  console.log("  5) dilewati — tidak ada permintaan cuti karyawan lain utk uji kepemilikan");
}

// ===== cleanup: batalkan dokumen uji =====
if (row?.id) {
  const c1 = await api("admin", "PATCH", "/api/rekankerja/leave/requests", { id: row.id, action: "cancel", note: "E2E P1.2 cleanup" });
  ok("cleanup: batalkan cuti CT-SAKIT uji", c1.status === 200, `status=${c1.status}`);
}
const thnRow = (await json(await api("admin", "GET", `/api/rekankerja/leave/requests?status=all`))).requests?.find((r: { docNo: string }) => r.docNo === thnDoc);
if (thnRow?.id) {
  const c2 = await api("admin", "PATCH", "/api/rekankerja/leave/requests", { id: thnRow.id, action: "cancel", note: "E2E P1.2 cleanup" });
  ok("cleanup: batalkan cuti CT-THN uji", c2.status === 200, `status=${c2.status}`);
}
if (medId) {
  const c3 = await api("admin", "PATCH", "/api/rekankerja/medical/claims", { id: medId, action: "cancel", note: "E2E P1.2 cleanup" });
  ok("cleanup: batalkan klaim medis uji", c3.status === 200, `status=${c3.status}`);
}

console.log(failures.length === 0 ? "\nSEMUA TES LULUS ✔" : `\nGAGAL: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
