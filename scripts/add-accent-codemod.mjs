// One-shot codemod (Task 64f lanjutan): semua kelas palet per-modul → kelas aksen global.
// Nama token: `brand` (bg-brand, text-brand, border-brand/40, text-brand-deep, …)
// didefinisikan via @theme inline di globals.css mengikuti --accent-live / --accent-live-deep.
//
// Aturan per-prefix (memelihara hierarki visual terhadap SATU aksen):
//   text   : 50–300 → brand/75, 400 → brand/85, 500–600 → brand, 700+ → brand-deep
//   bg     : 50 → brand/10, 100 → /15, 200 → /25, 300 → /35, 400 → /55,
//            500–600 → brand, 700 → /70, 800 → /80, 900/950 → /90
//   border : 50–200 → /25, 300–400 → /40, 500–600 → brand, 700+ → /70
//   lainnya (from/to/via/ring/fill/stroke/divide/outline/shadow/caret/decoration):
//            50–400 → /40..60, 500–600 → brand, 700+ → /70
// Scoping agar warna SEMANTIK tidak hilang:
//   · Global : emerald, teal, cyan, violet, sky, indigo → brand (identitas umum)
//   · payroll/  : + amber → brand (identitas Payroll; warning di luar payroll tetap amber)
//   · medical/  : + rose  → brand (identitas Medical; danger di luar medical tetap rose)
//   · red-* tidak pernah disentuh (destructive).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const GLOBAL_FAMILIES = ["emerald", "teal", "cyan", "violet", "sky", "indigo"];
const DIR_EXTRA = { payroll: ["amber"], medical: ["rose"] };
const PREFIXES = "text|bg|border|from|to|via|ring|fill|stroke|divide|outline|shadow|caret|decoration";
const SHADES = "50|100|200|300|400|500|600|700|800|900|950";

const RULES = {
  text: { "50": "brand/75", "100": "brand/75", "200": "brand/75", "300": "brand/75", "400": "brand/85", "500": "brand", "600": "brand", "700": "brand-deep", "800": "brand-deep", "900": "brand-deep", "950": "brand-deep" },
  bg: { "50": "brand/10", "100": "brand/15", "200": "brand/25", "300": "brand/35", "400": "brand/55", "500": "brand", "600": "brand", "700": "brand/70", "800": "brand/80", "900": "brand/90", "950": "brand/90" },
  border: { "50": "brand/25", "100": "brand/25", "200": "brand/25", "300": "brand/40", "400": "brand/40", "500": "brand", "600": "brand", "700": "brand/70", "800": "brand/70", "900": "brand/70", "950": "brand/70" },
};
const DEFAULT_RULE = { "50": "brand/20", "100": "brand/25", "200": "brand/30", "300": "brand/40", "400": "brand/60", "500": "brand", "600": "brand", "700": "brand/70", "800": "brand/80", "900": "brand/85", "950": "brand/90" };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src/rekankerja");
let touched = 0, replaced = 0;
for (const f of files) {
  const families = [...GLOBAL_FAMILIES];
  const norm = f.replace(/\\/g, "/");
  for (const [dir, extra] of Object.entries(DIR_EXTRA)) {
    if (norm.includes(`/rekankerja/${dir}/`)) families.push(...extra);
  }
  const RE = new RegExp(`\\b(${PREFIXES})-(${families.join("|")})-(${SHADES})\\b`, "g");
  const src = readFileSync(f, "utf8");
  let count = 0;
  const next = src.replace(RE, (_m, prefix, _family, shade) => {
    count++;
    const table = RULES[prefix] ?? DEFAULT_RULE;
    return `${prefix}-${table[shade]}`;
  });
  if (count > 0) {
    writeFileSync(f, next);
    touched++;
    replaced += count;
    console.log(`${f}: ${count}`);
  }
}
console.log(`\nTOTAL files=${touched} replacements=${replaced}`);
