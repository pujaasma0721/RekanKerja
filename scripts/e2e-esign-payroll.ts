/**
 * Task 80e — E2E eSign pada PayrollRun:
 *  1. login owner
 *  2. pilih run Confirmed/Paid terbaru → pastikan tertandatangani (PIN faktor)
 *  3. GET /api/onevity/payslip/<lineId>?download=1 → PDF harus memuat:
 *     - objek gambar (QR) → "/Image" di raw bytes
 *     - teks "DITANDATANGANI SECARA ELEKTRONIK" + URL /v/<id> + hash (inflate stream)
 *  4. buka URL /v/<id> → status VALID (ttd PayrollRun, chainIntact).
 * Jalankan: npx tsx scripts/e2e-esign-payroll.ts <base> <email> <pass>
 */
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "https://sayone.sayone.my.id";
const EMAIL = process.argv[3];
const PASS = process.argv[4];
if (!EMAIL || !PASS) { console.error("usage: tsx e2e-esign-payroll.ts <base> <email> <pass>"); process.exit(2); }

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function jar(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  return (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

/** Teks konten PDF: raw bytes + semua stream (flate/raw); teks pdf-lib = hex string. */
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

interface RunItem { id: string; runNo: string; status: string; }
interface RunDetailShape { run: { id: string; runNo: string; status: string; period: { name: string }; lines: { id: string; employeeName: string }[] }; }

async function main(): Promise<void> {
  // 1. login
  const rL = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }), redirect: "manual",
  });
  const cookie = jar(rL);
  check("login", rL.status === 200 && !!cookie, `status ${rL.status}`);

  // 2. pilih run Confirmed/Paid terbaru
  const rRuns = await fetch(`${BASE}/api/onevity/payroll-runs`, { headers: { cookie } });
  const runsJ = (await rRuns.json()) as { runs?: RunItem[] };
  const runs = runsJ.runs ?? [];
  const target = runs.find((r) => r.status === "Confirmed" || r.status === "Paid");
  check("run Confirmed/Paid tersedia", !!target, target ? `${target.runNo} (${target.status})` : `total run ${runs.length}`);
  if (!target) process.exit(1);

  // pastikan tertandatangani (PIN faktor — deterministik)
  const PIN = "471029";
  await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "set-pin", pin: PIN }),
  });
  await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "challenge", docType: "PayrollRun", docId: target.id }),
  });
  const rSign = await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "sign", docType: "PayrollRun", docId: target.id, code: PIN }),
  });
  const signJ = (await rSign.json()) as { ok?: boolean; message?: string; signatureId?: string };
  check("sign PayrollRun (201)", rSign.status === 201 && !!signJ.signatureId, `${target.runNo} — ${signJ.message ?? rSign.status}`);
  const sigId = signJ.signatureId;

  // 3. detail run → line pertama → unduh PDF slip
  const rDet = await fetch(`${BASE}/api/onevity/payroll-run?id=${target.id}`, { headers: { cookie } });
  const detJ = (await rDet.json()) as RunDetailShape;
  const line = detJ.run?.lines?.[0];
  check("detail run + line tersedia", !!line, line ? `${line.employeeName}` : "tidak ada line");

  const rPdf = await fetch(`${BASE}/api/onevity/payslip/${line.id}?download=1`, { headers: { cookie } });
  const pdfBuf = Buffer.from(await rPdf.arrayBuffer());
  check("PDF slip (200, application/pdf)", rPdf.status === 200 && (rPdf.headers.get("content-type") ?? "").includes("pdf"), `${pdfBuf.length} bytes`);
  const hasImage = pdfBuf.includes("/Image");
  check("QR tersemat (objek gambar PNG)", hasImage, hasImage ? "ada XObject /Image" : "tidak ada gambar");
  const text = pdfText(pdfBuf);
  check("blok ttd run ada", text.includes("DITANDATANGANI SECARA ELEKTRONIK"));
  check("Run ref tercetak", text.includes(`Run ${target.runNo}`));
  const urlHit = text.match(/https?:\/\/[^\s]+\/v\/[a-z0-9]+/i);
  check("URL verifikasi /v/<id> tercetak", !!urlHit, urlHit?.[0] ?? "tidak ketemu");
  check("hash tercetak", /Hash:\s*[0-9a-f]{16}(\u2026|\.{3})/.test(text));

  // 4. verifikasi publik
  if (urlHit && sigId) {
    const rV = await fetch(urlHit[0]);
    const vText = await rV.text();
    check("halaman /v merender VALID", rV.status === 200 && vText.includes("TANDA TANGAN VALID"), `status ${rV.status}`);
    const rApi = await fetch(`${BASE}/api/public/esign-verify?id=${sigId}`);
    const vJ = (await rApi.json()) as { found?: boolean; valid?: boolean; docType?: string; docRef?: string; chainIntact?: boolean };
    check("API verifikasi: valid + chain utuh", vJ.valid === true && vJ.chainIntact === true, `${vJ.docType} ${vJ.docRef ?? ""} chainIntact=${String(vJ.chainIntact)}`);
  }

  console.log(failures === 0 ? "\nSEMUA PASS" : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {}; // jadikan module — hindari collision global-scope antar skrip
