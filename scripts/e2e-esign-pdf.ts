/**
 * Task 80b — E2E stempel e-Sign pada PDF surat:
 *  1. login owner
 *  2. pilih surat terbit pertama → pastikan tertandatangani (PIN faktor)
 *  3. GET /api/onevity/letters/<id>/pdf → PDF harus memuat:
 *     - objek gambar (QR) → "/Image" di raw bytes
 *     - teks "DITANDATANGANI SECARA ELEKTRONIK" + URL /v/<id> (setelah inflate stream)
 *  4. surat TANPA ttd → PDF TIDAK boleh memuat blok e-Sign (negatif).
 * Jalankan: npx tsx scripts/e2e-esign-pdf.ts <base> <email> <pass>
 */
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "https://sayone.sayone.my.id";
const EMAIL = process.argv[3];
const PASS = process.argv[4];
if (!EMAIL || !PASS) { console.error("usage: tsx e2e-esign-pdf.ts <base> <email> <pass>"); process.exit(2); }

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function jar(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  return (h.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

/**
 * Teks konten PDF: raw bytes (content stream tanpa kompresi) + semua stream
 * flate. Teks drawText ditulis pdf-lib sebagai HEX STRING `<…> Tj` —
 * didekode balik ke latin1 agar marker terbaca.
 */
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
  // dekode hex string <…> Tj / <…> ' (pdf-lib menulis teks dalam hex)
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
  const rL = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }), redirect: "manual",
  });
  const cookie = jar(rL);
  check("login", rL.status === 200 && !!cookie, `status ${rL.status}`);

  const rLs = await fetch(`${BASE}/api/onevity/letters`, { headers: { cookie } });
  const ls = (await rLs.json()) as { letters?: { id: string; refNo: string; subject?: string | null }[] };
  const letters = ls.letters ?? [];
  check("daftar surat", rLs.status === 200 && letters.length > 0, `${letters.length} surat`);
  const target = letters[0];
  if (!target) process.exit(1);

  // pastikan surat target tertandatangani (PIN faktor — deterministik)
  const PIN = "471029";
  await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "set-pin", pin: PIN }),
  });
  await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "challenge", docType: "LetterDocument", docId: target.id }),
  });
  const rSign = await fetch(`${BASE}/api/onevity/esign`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "sign", docType: "LetterDocument", docId: target.id, code: PIN }),
  });
  check("surat tertandatangani", rSign.status === 201, `${target.refNo} status ${rSign.status}`);

  // unduh PDF surat yang SUDAH ditandatangani
  const rPdf = await fetch(`${BASE}/api/onevity/letters/${target.id}/pdf`, { headers: { cookie } });
  const pdfBuf = Buffer.from(await rPdf.arrayBuffer());
  check("PDF terbit (200, application/pdf)", rPdf.status === 200 && (rPdf.headers.get("content-type") ?? "").includes("pdf"), `${pdfBuf.length} bytes`);
  const hasImage = pdfBuf.includes("/Image");
  check("QR tersemat (objek gambar PNG)", hasImage, hasImage ? "ada XObject /Image" : "tidak ada gambar");
  const text = pdfText(pdfBuf);
  check("blok ttd ada", text.includes("DITANDATANGANI SECARA ELEKTRONIK"));
  const urlHit = text.match(/https?:\/\/[^\s]+\/v\/[a-z0-9]+/i);
  check("URL verifikasi /v/<id> tercetak", !!urlHit, urlHit?.[0] ?? "tidak ketemu");
  check("hash tercetak", /Hash:\s*[0-9a-f]{16}(\u2026|\.{3})/.test(text));

  // negatif: surat lain yang BELUM ditandatangani → tanpa blok e-sign
  // (cari surat kedua; jika semuanya sudah ditandatangani, uji dilewati)
  const unsigned = letters.find((l) => l.id !== target.id);
  if (unsigned) {
    const rPdf2 = await fetch(`${BASE}/api/onevity/letters/${unsigned.id}/pdf`, { headers: { cookie } });
    const buf2 = Buffer.from(await rPdf2.arrayBuffer());
    const text2 = pdfText(buf2);
    const clean = !text2.includes("DITANDATANGANI SECARA ELEKTRONIK") && !buf2.includes("/Image");
    check(`PDF tanpa ttd bersih (${unsigned.refNo})`, rPdf2.status === 200 && clean, clean ? "tanpa blok e-sign" : "masih memuat blok/gambar!");
  } else {
    console.log("SKIP  uji negatif — semua surat sudah ditandatangani");
  }

  console.log(failures === 0 ? "\nSEMUA PASS" : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {}; // jadikan module — hindari collision global-scope antar skrip
