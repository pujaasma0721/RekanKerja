// ============================================================================
// RECRUITMENT F6a — Ekstraksi teks dokumen CV (PDF/DOCX/TXT) TANPA dependency
// npm baru (node:zlib murni). DEVELOPMENT-PLAN-RECRUITMENT.md §7 F6a (HRX B1).
//
// Sumber CV pelamar = ApplicantDocument → Attachment (storagePath uploads/…).
// Whitelist attachment hanya JPG/PNG/WEBP/PDF → jalur utama PDF; DOCX & TXT
// diproses bila buffer datang dari kanal lain (uji, integrasi masa depan).
//
// Batasan rilis ini (dilabeli jujur di service pemanggil):
//   - PDF hasil SCAN/gambar (tanpa layer teks) → null (< 80 karakter teks).
//   - JPG/PNG/WEBP → null (OCR via VLM menyusul — F6c backlog).
//   - PDF terenkripsi / filter selain FlateDecode → stream dilewati.
// =====================================================================
import { inflateSync, inflateRawSync } from "node:zlib";

/** Batas atas teks hasil ekstraksi (karakter) — melindungi memori & LLM. */
export const MAX_CV_TEXT_CHARS = 120_000;

/** PDF dengan teks ter-ekstraksi di bawah ambang ini dianggap hasil scan. */
const MIN_PDF_TEXT_CHARS = 80;

export interface CvTextExtract {
  text: string;
  /** pdf | docx | txt — sesuai ekstensi asli sumber. */
  sourceKind: string;
}

/** Deteksi extension dari nama file (lowercase, tanpa path). */
function extOf(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/**
 * Ekstrak teks dari buffer dokumen CV.
 * Return null bila jenis tidak didukung / gambar (OCR belum tersedia) /
 * PDF scan tanpa layer teks / DOCX tanpa word/document.xml.
 */
export function extractCvText(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): CvTextExtract | null {
  if (!buffer || buffer.length === 0) return null;
  const ext = extOf(fileName ?? "");
  const magic = buffer.subarray(0, 5).toString("latin1");
  const isPdf = ext === "pdf" || magic.startsWith("%PDF-") || mimeType === "application/pdf";
  const isZip = (ext === "docx" || (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)) &&
    mimeType !== "application/pdf";
  const isImage =
    ["jpg", "jpeg", "png", "webp"].includes(ext) ||
    (mimeType ?? "").startsWith("image/");

  if (isImage) return null; // OCR tidak didukung rilis ini

  if (isPdf) {
    const text = extractPdfText(buffer);
    if (text == null || text.length < MIN_PDF_TEXT_CHARS) return null; // scan/gambar
    return { text: capText(text), sourceKind: "pdf" };
  }

  if (isZip || ext === "docx") {
    const text = extractDocxText(buffer);
    if (text == null || text.trim().length === 0) return null;
    return { text: capText(text), sourceKind: "docx" };
  }

  if (ext === "txt" || ext === "md" || (!isPdf && !isZip && looksLikeText(buffer))) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    if (text.trim().length === 0) return null;
    return { text: capText(cleanControlChars(text)), sourceKind: "txt" };
  }

  return null; // jenis tak dikenal
}

// ---------------------------------------------------------------------------
// helpers umum
// ---------------------------------------------------------------------------

function capText(text: string): string {
  return text.length > MAX_CV_TEXT_CHARS ? text.slice(0, MAX_CV_TEXT_CHARS) : text;
}

/** Buang karakter kontrol kecuali \n \t (null bytes dari PDF dsb.). */
function cleanControlChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\t" || (code >= 32 && code !== 127)) out += ch;
    else if (code === 13) continue; // \r dibuang
  }
  return out.replace(/[ \t]{3,}/g, "  ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Heuristik: buffer bisa dibaca sebagai teks (bukan biner). */
function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  if (!sample) return false;
  let bad = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\uFFFD" || (code < 32 && ch !== "\n" && ch !== "\r" && ch !== "\t")) bad++;
  }
  return bad / sample.length <= 0.02;
}

// ---------------------------------------------------------------------------
// PDF — scan stream objects + operator teks Tj/TJ (tanpa parser penuh)
// ---------------------------------------------------------------------------

function extractPdfText(buf: Buffer): string | null {
  const latin = buf.toString("latin1");
  const parts: string[] = [];
  let pos = 0;
  while (pos < latin.length) {
    const s = latin.indexOf("stream", pos);
    if (s < 0) break;
    pos = s + 6;
    // bukan keyword "stream" bila bagian dari "endstream"
    if (s >= 3 && latin.slice(s - 3, s) === "end") continue;
    // dict sebelum stream: window dari "obj" terakhir (atau awal) sampai s
    const objAt = latin.lastIndexOf("obj", s);
    const dict = latin.slice(Math.max(0, objAt), s);

    // skip stream data non-teks (gambar & kompresi tak dikenal)
    if (/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|RunLengthDecode|LZWDecode)/.test(dict)) continue;

    // awal data: lewati EOL setelah keyword "stream"
    let dataStart = s + 6;
    if (latin[dataStart] === "\r" && latin[dataStart + 1] === "\n") dataStart += 2;
    else if (latin[dataStart] === "\n" || latin[dataStart] === "\r") dataStart += 1;

    // akhir data: /Length eksplisit bila angka langsung; fallback cari "endstream"
    let dataEnd = -1;
    const lenMatch = /\/Length\s+(\d+)(?!\d)/.exec(dict);
    if (lenMatch) {
      const cand = dataStart + Number(lenMatch[1]);
      if (cand <= latin.length) {
        const after = latin.slice(cand, cand + 24);
        if (/^\s*(endstream|>>|endobj)/.test(after)) dataEnd = cand;
      }
    }
    if (dataEnd < 0) {
      const e = latin.indexOf("endstream", dataStart);
      if (e < 0) continue;
      dataEnd = e;
      pos = e + 9;
    }

    const raw = buf.subarray(dataStart, dataEnd);
    let content: Buffer | null = raw;
    if (/\/FlateDecode/.test(dict)) {
      try {
        content = inflateSync(raw);
      } catch {
        try {
          content = inflateRawSync(raw);
        } catch {
          content = null; // stream korup/terenkripsi → lewati
        }
      }
    }
    if (content && content.length > 0) parts.push(pdfContentText(content));
  }
  const text = parts.join("\n");
  return text.length === 0 ? null : cleanControlChars(text);
}

/** Operator penampil teks → string; operand: literal/hex string + array TJ. */
function pdfContentText(content: Buffer): string {
  const s = content.toString("latin1");
  const out: string[] = [];
  /** stack operand: string literal/hex, atau array (utk TJ). */
  type Opnd = { kind: "str"; str: string } | { kind: "arr"; items: string[] };
  let operands: Opnd[] = [];

  const pushOperand = (str: string) => {
    const top = operands[operands.length - 1];
    if (top && top.kind === "arr") top.items.push(str);
    else operands.push({ kind: "str", str });
  };

  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0") {
      i++;
      continue;
    }
    if (c === "%") {
      // komentar sampai EOL
      while (i < n && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    if (c === "(") {
      const [str, next] = readPdfLiteralString(s, i);
      pushOperand(str);
      i = next;
      continue;
    }
    if (c === "<" && s[i + 1] !== "<") {
      const [str, next] = readPdfHexString(s, i);
      pushOperand(str);
      i = next;
      continue;
    }
    if (c === "[") {
      operands.push({ kind: "arr", items: [] });
      i++;
      continue;
    }
    if (c === "<" || c === ">") {
      // << ... >> pembatas dict — buang operand menumpuk
      i += s[i + 1] === c ? 2 : 1;
      operands = [];
      continue;
    }
    if (c === "]" || c === ")" || c === "{" || c === "}") {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      // operator show-baris-baru (str ' / aw ac str ") — string operand terakhir
      const last = operands[operands.length - 1];
      if (last && last.kind === "str") out.push(last.str + "\n");
      operands = [];
      i++;
      continue;
    }
    if (c === "/") {
      // nama PDF (/Font) — bukan operator; skip sampai whitespace/delimiter
      i++;
      while (i < n && !/[\s()\[\]<>{}/%]/.test(s[i])) i++;
      continue;
    }
    // token biasa: operator / angka / keyword
    const tokStart = i;
    while (i < n && !/[\s()\[\]<>{}/%]/.test(s[i])) i++;
    const token = s.slice(tokStart, i);
    if (!token) {
      i++;
      continue;
    }
    if (isPdfOperator(token)) {
      const last = operands[operands.length - 1];
      if (token === "TJ" && last && last.kind === "arr") {
        out.push(last.items.join(""));
      } else if ((token === "Tj" || token === "'" || token === '"') && last && last.kind === "str") {
        out.push(last.str);
      } else if (["Td", "TD", "T*", "Tm", "TL", "ET", "BT"].includes(token)) {
        if (out.length > 0 && out[out.length - 1] !== "\n") out.push("\n");
      }
      operands = [];
    }
  }
  return out.join(" ");
}

function isPdfOperator(token: string): boolean {
  // operator PDF murni alfabetis/asterisk; angka & nama sudah tersaring.
  return /^[A-Za-z'*"]+$/.test(token);
}

/** Baca literal string PDF mulai '(' di i → [teks, index setelah ')']. */
function readPdfLiteralString(s: string, i: number): [string, number] {
  let j = i + 1;
  let depth = 1;
  let out = "";
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") {
      const nx = s[j + 1];
      if (nx === undefined) break;
      if (nx === "n") out += "\n";
      else if (nx === "r") out += "\r";
      else if (nx === "t") out += "\t";
      else if (nx === "b") out += "\b";
      else if (nx === "f") out += "\f";
      else if (nx === "(" || nx === ")" || nx === "\\") out += nx;
      else if (nx >= "0" && nx <= "7") {
        // oktal hingga 3 digit
        let oct = "";
        let k = j + 1;
        while (k < s.length && oct.length < 3 && s[k] >= "0" && s[k] <= "7") {
          oct += s[k];
          k++;
        }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        j = k;
        continue;
      } else if (nx === "\n") {
        // line continuation — buang
      } else if (nx === "\r") {
        if (s[j + 2] === "\n") j++;
      } else {
        out += nx;
      }
      j += 2;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) return [out, j + 1];
    }
    out += c;
    j++;
  }
  return [out, j]; // unterminated — best effort
}

/** Baca hex string PDF mulai '<' di i → [teks, index setelah '>']. */
function readPdfHexString(s: string, i: number): [string, number] {
  const close = s.indexOf(">", i + 1);
  if (close < 0) return ["", s.length];
  const hex = s.slice(i + 1, close).replace(/[^0-9A-Fa-f]/g, "");
  if (hex.length === 0 || hex.length % 2 !== 0) return ["", close + 1]; // ganjil/invalid → abaikan
  const bytes = Buffer.from(hex, "hex");
  return [bytes.toString("latin1"), close + 1];
}

// ---------------------------------------------------------------------------
// DOCX — parse ZIP (EOCD + central directory) → word/document.xml → teks
// ---------------------------------------------------------------------------

function extractDocxText(buf: Buffer): string | null {
  // End of Central Directory record: scan dari belakang signature PK\x05\x06
  let eocd = -1;
  const scanFloor = Math.max(0, buf.length - 22 - 65557);
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset central directory
  let xml: Buffer | null = null;

  for (let e = 0; e < entryCount; e++) {
    if (p + 46 > buf.length) break;
    if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02)) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === "word/document.xml" && localOff + 30 <= buf.length) {
      // local file header: 30 byte + nama + extra → data
      if (buf[localOff] === 0x50 && buf[localOff + 1] === 0x4b && buf[localOff + 2] === 0x03 && buf[localOff + 3] === 0x04) {
        const lnameLen = buf.readUInt16LE(localOff + 26);
        const lextraLen = buf.readUInt16LE(localOff + 28);
        const dataStart = localOff + 30 + lnameLen + lextraLen;
        const data = buf.subarray(dataStart, Math.min(buf.length, dataStart + compSize));
        try {
          xml = method === 0 ? Buffer.from(data) : inflateRawSync(data);
        } catch {
          xml = null;
        }
      }
      break;
    }
    p += 46 + nameLen + extraLen + commLen;
  }
  if (!xml) return null;
  return docxXmlToText(xml.toString("utf8"));
}

/** Gabung isi <w:t>; newline per paragraf <w:p>; tab/br dihormati. */
function docxXmlToText(xml: string): string {
  let text = "";
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    const gt = xml.indexOf(">", lt);
    if (gt < 0) break;
    const tag = xml.slice(lt, gt + 1);
    if (isWTag(tag, "w:p")) {
      if (!tag.endsWith("/>")) text += "\n";
    } else if (isWTag(tag, "w:t")) {
      if (!tag.endsWith("/>")) {
        const close = xml.indexOf("</w:t>", gt);
        if (close < 0) break;
        text += decodeXmlEntities(xml.slice(gt + 1, close));
        i = close + 6;
        continue;
      }
    } else if (isWTag(tag, "w:tab")) {
      text += "\t";
    } else if (isWTag(tag, "w:br")) {
      text += "\n";
    }
    i = gt + 1;
  }
  return cleanControlChars(text);
}

/** Tag <w:p ...> / <w:p> / <w:p/> — bukan <w:pPr> / <w:tbl> dsb. */
function isWTag(tag: string, name: string): boolean {
  if (!tag.startsWith(`<${name}`) && !tag.startsWith(`</${name}`)) return false;
  const rest = tag.slice(1 + name.length);
  return rest.length === 0 || !/[A-Za-z0-9:_.-]/.test(rest[0] ?? "");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
