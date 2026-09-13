// One-shot codemod (Task 64f — auth): aksen amber mikro di layar auth
// (caret, border fokus, logo "Vity", spinner, OTP underline, pill/ring/hover)
// → kelas brand global yang mengikuti tema topbar.
// CTA tinta hitam (bg-stone-900) TIDAK disentuh — ciri desain editorial.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAP = {
  "200": "brand/25",
  "400": "brand",
  "500": "brand",
  "600": "brand",
  "700": "brand-deep",
  "800": "brand-deep",
};
const FAMILIES = "emerald|amber|teal|cyan|violet|rose|sky|indigo";
const PREFIXES = "text|bg|border|ring|caret|from|to|via|fill|stroke|decoration|outline|divide";
const RE = new RegExp(`\\b(${PREFIXES})-(${FAMILIES})-(50|100|200|300|400|500|600|700|800|900|950)\\b`, "g");
const ruleFor = (prefix, shade) => {
  const t = { text: { "50": "brand/75", "100": "brand/75", "200": "brand/75", "300": "brand/75", "400": "brand/85", "500": "brand", "600": "brand", "700": "brand-deep", "800": "brand-deep", "900": "brand-deep", "950": "brand-deep" }, border: { "50": "brand/25", "100": "brand/25", "200": "brand/25", "300": "brand/40", "400": "brand/40", "500": "brand", "600": "brand", "700": "brand/70", "800": "brand/70", "900": "brand/70", "950": "brand/70" } };
  return (t[prefix] ?? { "50": "brand/10", "100": "brand/15", "200": "brand/25", "300": "brand/35", "400": "brand/55", "500": "brand", "600": "brand", "700": "brand/70", "800": "brand/80", "900": "brand/90", "950": "brand/95" })[shade];
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

let touched = 0, replaced = 0;
for (const f of walk("src/onevity/shared/components/auth")) {
  const src = readFileSync(f, "utf8");
  let count = 0;
  const next = src.replace(RE, (_m, prefix, _fam, shade) => {
    count++;
    return `${prefix}-${ruleFor(prefix, shade)}`;
  });
  if (count) {
    writeFileSync(f, next);
    touched++; replaced += count;
    console.log(`${f}: ${count}`);
  }
}
console.log(`TOTAL files=${touched} replacements=${replaced}`);
