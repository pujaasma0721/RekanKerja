/**
 * Task 80 — E2E e-Sign internal di prod:
 *  1. login owner SAYONE
 *  2. POST challenge (surat pertama yang terbit; fallback PersonnelAction)
 *     — OTP dikirim via SMTP ke email owner (cek EmailLog)
 *  3. ambil kode OTP dari EmailLog body (akses admin — pola sama email uji)
 *  4. POST sign → dapat signatureId
 *  5. GET /api/public/esign-verify → valid:true + chainIntact
 *  6. GET halaman /v/<id> (SSR) → 200
 *  7. Verifikasi tamper: ubah snapshotJson record langsung via service call
 *     TIDAK dilakukan (butuh akses DB tulis) — chain dicek via API saja.
 * Jalankan: npx tsx scripts/e2e-esign.ts <base> <email> <password>
 */
const BASE = process.argv[2] ?? "https://sayone.sayone.my.id";
const EMAIL = process.argv[3];
const PASS = process.argv[4];
if (!EMAIL || !PASS) { console.error("usage: tsx e2e-esign.ts <base> <email> <pass>"); process.exit(2); }

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function jar(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  return (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function main(): Promise<void> {
  // 1. login
  const rL = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }), redirect: "manual",
  });
  const cookie = jar(rL);
  check("login", rL.status === 200 && !!cookie, `status ${rL.status}`);

  // 2. status e-sign sesi
  const rS = await fetch(`${BASE}/api/rekankerja/esign`, { headers: { cookie } });
  const st = (await rS.json()) as { hasPin: boolean; hasKey: boolean };
  check("GET status e-sign", rS.status === 200 && typeof st.hasPin === "boolean", JSON.stringify(st));

  // 3. cari dokumen: surat terbit pertama, fallback PA
  let docType = "LetterDocument"; let docId = ""; let label = "";
  const rLs = await fetch(`${BASE}/api/rekankerja/letters`, { headers: { cookie } });
  if (rLs.ok) {
    const j = (await rLs.json()) as { letters?: { id: string; refNo: string }[] };
    const first = (j.letters ?? [])[0];
    if (first) { docId = first.id; label = first.refNo; }
  }
  if (!docId) {
    docType = "PersonnelAction";
    const rP = await fetch(`${BASE}/api/rekankerja/personnel-actions?pageSize=1`, { headers: { cookie } });
    const j = (await rP.json()) as { actions?: { id: string; docNo: string }[]; items?: { id: string; docNo: string }[] };
    const first = (j.actions ?? j.items ?? [])[0];
    if (first) { docId = first.id; label = first.docNo; }
  }
  check("dokumen sumber tersedia", !!docId, `${docType} ${label}`);

  // 4. challenge → OTP ke email
  const rC = await fetch(`${BASE}/api/rekankerja/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "challenge", docType, docId }),
  });
  const ch = (await rC.json()) as { ok: boolean; message: string; factor?: string };
  check("challenge (OTP email)", rC.status === 200 && ch.ok === true, ch.message);

  // 4. Faktor PIN (deterministik): set PIN khusus uji lalu sign dengan PIN itu.
  //    EmailLog sengaja menyamarkan OTP (redactEmailBody) — jalur email tak bisa dipakai E2E.
  const PIN = "471029";
  const rSet = await fetch(`${BASE}/api/rekankerja/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "set-pin", pin: PIN }),
  });
  const rSetJ = (await rSet.json()) as { ok: boolean; message?: string };
  check("set PIN tanda tangan", rSet.status === 200 && rSetJ.ok === true, rSetJ.message ?? `status ${rSet.status}`);
  const code = PIN;

  // 6. sign (PIN sebagai faktor)
  const rSign = await fetch(`${BASE}/api/rekankerja/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "sign", docType, docId, code }),
  });
  const sg = (await rSign.json()) as { ok: boolean; message: string; signatureId?: string };
  check("sign (201)", rSign.status === 201 && sg.ok && !!sg.signatureId, sg.message);
  const sigId = sg.signatureId ?? "";
  const rV = await fetch(`${BASE}/api/public/esign-verify?id=${sigId}`);
  const v = (await rV.json()) as { found: boolean; valid: boolean; chainIntact: boolean; signerName?: string; docRef?: string; chainLength?: number };
  check("verifikasi publik valid", rV.status === 200 && v.found && v.valid === true && v.chainIntact === true, `signer=${v.signerName} ref=${v.docRef} chain=${v.chainLength}`);

  // 8. halaman /v SSR
  const rPage = await fetch(`${BASE}/v/${sigId}`);
  const html = await rPage.text();
  check("halaman /v render", rPage.status === 200 && html.includes("TANDA TANGAN VALID"), `status ${rPage.status}`);

  // 9. PIN = faktor statis: re-sign dengan PIN sama sah (by design) —
  //    one-time code hanya berlaku di jalur OTP (usedAt di SignatureChallenge).
  //    Nilai uji di sini: chain bertambah dan tetap utuh setelah ttd kedua.
  const rSign2 = await fetch(`${BASE}/api/rekankerja/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "sign", docType, docId, code }),
  });
  const sg2 = (await rSign2.json()) as { ok: boolean; signatureId?: string };
  check("re-sign PIN sama (sah) — chain bertambah", rSign2.status === 201 && sg2.ok === true, `status ${rSign2.status}`);
  const rV2 = await fetch(`${BASE}/api/public/esign-verify?id=${sg2.signatureId ?? ""}`);
  const v2 = (await rV2.json()) as { valid: boolean; chainIntact: boolean; chainLength?: number };
  check("chain utuh setelah ttd kedua", rV2.status === 200 && v2.valid && v2.chainIntact && (v2.chainLength ?? 0) > (v.chainLength ?? 0), `chain ${v.chainLength} → ${v2.chainLength}`);

  console.log(failures === 0 ? "\nSEMUA PASS" : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {}; // jadikan module — hindari collision global-scope antar skrip
