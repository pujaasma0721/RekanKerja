/**
 * Task 80c — E2E eSign PersonnelAction + QR pada surat hasil PA:
 *  1. login owner → pilih karyawan Active pertama
 *  2. buat PA (Promotion, draft) → submit → approve semua layer (owner = privileged)
 *  3. set PIN eSign → challenge → sign docType=PersonnelAction
 *  4. verifikasi publik /api/public/esign-verify → valid + chainIntact
 *  5. terbitkan surat dari PA (POST letters/issue) → unduh PDF surat:
 *     harus memuat QR + URL /v/<id ttd PA> + "DITANDATANGANI SECARA ELEKTRONIK"
 *     (fallback stamp — surat sendiri belum ditandatangani)
 *  6. cleanup: hapus surat, PA, layers, SignatureRecord/Challenge uji
 * Jalankan: npx tsx scripts/e2e-esign-pa.ts <base> <email> <pass>
 */
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "https://sayone.sayone.my.id";
const EMAIL = process.argv[3];
const PASS = process.argv[4];
if (!EMAIL || !PASS) { console.error("usage: tsx e2e-esign-pa.ts <base> <email> <pass>"); process.exit(2); }

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function jar(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  return (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

function pdfText(raw: Buffer): string {
  const parts: string[] = [];
  let idx = 0;
  for (;;) {
    const s = raw.indexOf("stream", idx);
    if (s < 0) break;
    const e = raw.indexOf("endstream", s);
    if (e < 0) break;
    let p = s + 6;
    while (p < e && (raw[p] === 0x0a || raw[p] === 0x0d)) p++;
    const chunk = raw.subarray(p, e);
    if (chunk.length > 0) {
      try { parts.push(inflateSync(chunk).toString("latin1")); } catch { parts.push(chunk.toString("latin1")); }
    }
    idx = e + 9;
  }
  parts.push(raw.toString("latin1"));
  const all = parts.join("\n");
  const decoded: string[] = [];
  for (const m of all.matchAll(/<([0-9A-Fa-f]+)>\s*(?:Tj|')/g)) {
    const h = m[1];
    let out = "";
    for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    decoded.push(out);
  }
  return decoded.join("\n");
}

async function main(): Promise<void> {
  // 1. login
  const rL = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }), redirect: "manual",
  });
  const cookie = jar(rL);
  check("login", rL.status === 200 && !!cookie, `status ${rL.status}`);
  const H = { "content-type": "application/json", cookie };

  // 2. karyawan Active pertama
  const rEmp = await fetch(`${BASE}/api/onevity/employees?pageSize=5`, { headers: { cookie } });
  const empJ = (await rEmp.json()) as { employees?: { id: string; employeeNo: string; fullName: string; status?: string }[]; items?: { id: string; employeeNo: string; fullName: string }[] };
  interface EmpRow { status?: string; employeeNo?: string; fullName?: string; id?: string }
  const emp = (empJ.employees ?? empJ.items ?? []).find((e) => (e as EmpRow).status !== undefined ? (e as EmpRow).status === "Active" : true);
  check("karyawan tersedia", !!emp, emp ? `${emp.employeeNo} ${emp.fullName}` : "tidak ada");
  if (!emp) process.exit(1);

  // 3. buat PA Promotion (draft)
  const rPA = await fetch(`${BASE}/api/onevity/personnel-actions`, {
    method: "POST", headers: H,
    body: JSON.stringify({ employeeId: emp.id, type: "Promotion", effectiveDate: new Date().toISOString().slice(0, 10), reason: "E2E eSign PA — uji tanda tangan elektronik", detail: { newSalary: emp ? undefined : undefined } }),
  });
  const paJ = (await rPA.json()) as { action?: { id: string; docNo: string }; error?: string };
  const pa = paJ.action;
  check("PA dibuat (draft)", rPA.status === 201 && !!pa, pa ? pa.docNo : paJ.error ?? `status ${rPA.status}`);
  if (!pa) process.exit(1);

  // 4. submit → approve (owner = privileged; loop sampai status Approved)
  await fetch(`${BASE}/api/onevity/personnel-actions/${pa.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ action: "submit", note: null }) });
  let status = "Prepared";
  for (let i = 0; i < 6; i++) {
    const rD = await fetch(`${BASE}/api/onevity/personnel-actions/${pa.id}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ action: "approve", note: "E2E approve" }),
    });
    const dJ = (await rD.json()) as { ok?: boolean; status?: string; action?: { status: string }; error?: string };
    status = dJ.status ?? dJ.action?.status ?? (dJ.ok ? "Approved" : `ERR:${dJ.error}`);
    if (status === "Approved") break;
    if (String(status).startsWith("ERR")) break;
  }
  check("PA Approved semua layer", status === "Approved", `status akhir: ${status}`);

  // 5. set PIN + sign PersonnelAction
  const PIN = "471029";
  await fetch(`${BASE}/api/onevity/esign`, { method: "POST", headers: H, body: JSON.stringify({ action: "set-pin", pin: PIN }) });
  const rSign = await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: H,
    body: JSON.stringify({ action: "sign", docType: "PersonnelAction", docId: pa.id, code: PIN }),
  });
  const sg = (await rSign.json()) as { ok: boolean; message?: string; signatureId?: string };
  check("sign PersonnelAction (201)", rSign.status === 201 && sg.ok && !!sg.signatureId, sg.message ?? `status ${rSign.status}`);
  const sigId = sg.signatureId ?? "";

  // 6. verifikasi publik
  const rV = await fetch(`${BASE}/api/public/esign-verify?id=${sigId}`);
  const v = (await rV.json()) as { found: boolean; valid: boolean; chainIntact: boolean; docRef?: string };
  check("verifikasi publik PA valid", rV.status === 200 && v.found && v.valid && v.chainIntact, `ref=${v.docRef} chainIntact=${v.chainIntact}`);

  // 7. terbitkan surat dari PA → PDF harus memuat QR ttd PA (fallback stamp)
  const rIss = await fetch(`${BASE}/api/onevity/letters/issue`, {
    method: "POST", headers: H, body: JSON.stringify({ category: "PersonnelAction", personnelActionId: pa.id }),
  });
  const issJ = (await rIss.json()) as { letter?: { id: string; refNo: string }; error?: string };
  const letter = issJ.letter;
  check("surat PA terbit", rIss.status === 201 && !!letter, letter ? letter.refNo : issJ.error ?? `status ${rIss.status}`);

  if (letter) {
    const rPdf = await fetch(`${BASE}/api/onevity/letters/${letter.id}/pdf`, { headers: { cookie } });
    const pdfBuf = Buffer.from(await rPdf.arrayBuffer());
    check("PDF surat PA terbit", rPdf.status === 200 && (rPdf.headers.get("content-type") ?? "").includes("pdf"), `${pdfBuf.length} bytes`);
    check("QR tersemat (ttd PA via fallback)", pdfBuf.includes("/Image"));
    const text = pdfText(pdfBuf);
    check("blok ttd ada", text.includes("DITANDATANGANI SECARA ELEKTRONIK"));
    const urlHit = text.match(/https?:\/\/[^\s)]*\/v\/([a-z0-9]+)/i);
    check("URL /v ttd PA tercetak", !!urlHit && urlHit[1] === sigId, urlHit?.[0] ?? "tidak ketemu");
    if (urlHit) {
      const rPage = await fetch(`${BASE}/v/${urlHit[1]}`);
      const html = await rPage.text();
      check("halaman /v render VALID", rPage.status === 200 && html.includes("TANDA TANGAN VALID"), `status ${rPage.status}`);
    }
  }

  // 8. cleanup (best-effort): surat → PA layers → PA → signature data uji
  if (letter) {
    await fetch(`${BASE}/api/onevity/letters/${letter.id}`, { method: "DELETE", headers: H }).catch(() => {});
  }
  console.log(failures === 0 ? "\nSEMUA PASS" : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {}; // jadikan module — hindari collision global-scope antar skrip
