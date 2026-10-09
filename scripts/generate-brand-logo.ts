/**
 * Generator aset brand RekanKerja dari foto logo (JPG latar kertas).
 * Output:
 *   public/brand/rekankerja-lockup.png        (mark + teks, warna, transparan)
 *   public/brand/rekankerja-lockup-white.png  (mark + teks, putih solid, transparan)
 *   public/brand/rekankerja-mark.png          (perisai saja, warna, transparan)
 *   public/brand/rekankerja-mark-white.png    (perisai saja, putih, transparan)
 *   public/icons/icon-192x192.png / icon-512x512.png / apple 180 / maskable
 *   public/logo.svg  (favicon wrapper base64)
 */
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

const SRC = process.env.LOGO_SRC ?? "C:/Users/pujaasmara/Downloads/image_c6b0fc09.jpg";
const OUT_BRAND = "public/brand";
const OUT_ICONS = "public/icons";

type RGBA = { r: number; g: number; b: number; a: number };

async function loadRaw() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, ch: info.channels };
}

/** inkness: 0 = latar kertas, makin besar makin pasti bagian logo */
function inkness(r: number, g: number, b: number): number {
  const min = Math.min(r, g, b);
  const sat = Math.max(r, g, b) - min;
  const dark = Math.max(0, 238 - min); // teks navy & outline gelap
  const colored = Math.max(0, sat - 8); // teal/biru saturasi
  return dark + colored * 1.6;
}

function boxBlur1D(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const out = new Float32Array(src.length);
  const win = r * 2 + 1;
  // horizontal
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / win;
      const add = src[row + Math.min(W - 1, x + r + 1)];
      const rem = src[row + Math.max(0, x - r)];
      acc += add - rem;
    }
  }
  // vertical
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / win;
      const add = tmp[Math.min(H - 1, y + r + 1) * W + x];
      const rem = tmp[Math.max(0, y - r) * W + x];
      acc += add - rem;
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT_BRAND, { recursive: true });
  fs.mkdirSync(OUT_ICONS, { recursive: true });

  const { data, W, H, ch } = await loadRaw();

  // 1) peta alpha dari inkness + feather
  let ink: Float32Array = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    ink[i] = inkness(data[i * ch], data[i * ch + 1], data[i * ch + 2]);
  }
  const blurred = boxBlur1D(ink, W, H, 2); // haluskan tepi jpeg
  ink = blurred;
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = ink[i];
    alpha[i] = v <= 14 ? 0 : v >= 52 ? 255 : Math.round(((v - 14) / 38) * 255);
  }

  // 2) profil kolom/baris (fraksi piksel solid) untuk bbox & pemisahan mark/teks
  const colFrac = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) if (alpha[y * W + x] > 200) n++;
    colFrac[x] = n / H;
  }
  const rowFrac = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (alpha[y * W + x] > 200) n++;
    rowFrac[y] = n / W;
  }

  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let x = 0; x < W; x++) if (colFrac[x] > 0.004) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  for (let y = 0; y < H; y++) if (rowFrac[y] > 0.004) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX < 0) throw new Error("bbox kosong — threshold salah");

  // gap kolom terlebar di dalam bbox (pemisah mark teks)
  let gapStart = -1, gapBest = -1, gapA = -1, gapB = -1;
  for (let x = minX; x <= maxX; x++) {
    if (colFrac[x] <= 0.004) {
      if (gapStart < 0) gapStart = x;
    } else {
      if (gapStart >= 0 && x - gapStart > gapBest) { gapBest = x - gapStart; gapA = gapStart; gapB = x - 1; }
      gapStart = -1;
    }
  }
  console.log("bbox", { minX, minY, maxX, maxY }, "gap", { gapA, gapB, gapBest });
  if (gapBest < 12) throw new Error("gap mark/teks tidak terdeteksi");
  const markMaxX = gapA, textMinX = gapB + 1;

  /** render viewport RGBA dari alpha+data asli */
  function renderRGBA(x0: number, y0: number, x1: number, y1: number, whiteFill = false): { buf: Buffer; w: number; h: number } {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y + y0) * W + (x + x0)) * ch;
        const di = (y * w + x) * 4;
        const a = alpha[(y + y0) * W + (x + x0)];
        out[di] = whiteFill ? 255 : data[si];
        out[di + 1] = whiteFill ? 255 : data[si + 1];
        out[di + 2] = whiteFill ? 255 : data[si + 2];
        out[di + 3] = a;
      }
    }
    return { buf: out, w, h };
  }

  async function savePNG(rgba: { buf: Buffer; w: number; h: number }, file: string, trim = false, pad = 8) {
    let img = sharp(rgba.buf, { raw: { width: rgba.w, height: rgba.h, channels: 4 } });
    if (trim) {
      img = img.trim({ threshold: 1 });
    }
    let { data: d2, info: i2 } = await img.raw().toBuffer({ resolveWithObject: true });
    if (trim && pad > 0) {
      // tempel ke kanvas dengan padding (trim sharp bisa tak sempurna di tepi alpha rendah)
      const w = i2.width, h = i2.height;
      const cw = w + pad * 2, chh = h + pad * 2;
      const canvas = Buffer.alloc(cw * chh * 4, 0);
      for (let y = 0; y < h; y++) {
        d2.copy(canvas, ((y + pad) * cw + pad) * 4, y * w * 4, (y + 1) * w * 4);
      }
      d2 = canvas; i2 = { width: cw, height: chh, channels: 4 } as never;
    }
    await sharp(d2, { raw: { width: i2.width, height: i2.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(file);
    console.log("saved", file, i2.width + "x" + i2.height);
  }

  // lockup penuh
  const lockup = renderRGBA(minX, minY, maxX, maxY);
  await savePNG(lockup, path.join(OUT_BRAND, "rekankerja-lockup.png"), true);
  await savePNG(renderRGBA(minX, minY, maxX, maxY, true), path.join(OUT_BRAND, "rekankerja-lockup-white.png"), true);

  // mark saja
  const mark = renderRGBA(minX, minY, markMaxX, maxY);
  await savePNG(mark, path.join(OUT_BRAND, "rekankerja-mark.png"), true);
  await savePNG(renderRGBA(minX, minY, markMaxX, maxY, true), path.join(OUT_BRAND, "rekankerja-mark-white.png"), true);

  // baca mark hasil trim utk komposisi ikon
  const markBuf = fs.readFileSync(path.join(OUT_BRAND, "rekankerja-mark.png"));
  const markMeta = await sharp(markBuf).metadata();

  // ikon PWA — mark di atas kanvas putih, safe zone maskable 72%
  async function icon(size: number, file: string, opts: { maskable?: boolean; apple?: boolean } = {}) {
    const scale = opts.maskable ? 0.62 : 0.9;
    const inner = Math.round(size * scale);
    const markResized = await sharp(markBuf)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([{ input: markResized, gravity: "center" }])
      .png()
      .toFile(file);
    console.log("saved", file, size + "x" + size);
  }

  await icon(192, path.join(OUT_ICONS, "icon-192x192.png"));
  await icon(512, path.join(OUT_ICONS, "icon-512x512.png"));
  await icon(192, path.join(OUT_ICONS, "icon-maskable-192x192.png"), { maskable: true });
  await icon(512, path.join(OUT_ICONS, "icon-maskable-512x512.png"), { maskable: true });
  await icon(180, path.join(OUT_ICONS, "icon-180x180.png"), { apple: true });

  // favicon /logo.svg — wrapper base64 dari mark 64px
  const fav64 = await sharp(markBuf).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const svg = `<?xml version="1.0" encoding="utf-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${fav64.toString("base64")}"/></svg>`;
  fs.writeFileSync("public/logo.svg", svg);
  console.log("saved public/logo.svg (wrapper base64)");
}

main().catch((e) => { console.error(e); process.exit(1); });
