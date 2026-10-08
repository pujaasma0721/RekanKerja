// Parse SPT1721A1.jrxml -> compact element table for mapping analysis
// Usage: bun run scripts/parse-jrxml.ts
import { readFileSync, writeFileSync } from "node:fs";

const raw = readFileSync("/home/z/my-project/upload/SPT1721A1.jrxml", "utf8");
// normalize CRLF
const xml = raw.replace(/\r\n/g, "\n");

type El = {
  kind: string;
  x?: number; y?: number; w?: number; h?: number;
  text?: string;
  expr?: string;
  pattern?: string;
};

const out: El[] = [];
const tagRe = /<(staticText|textField|line|rectangle|image)\b[\s\S]*?<\/\1>|<(line|rectangle|image)\b[^>]*\/>/g;
let m: RegExpExecArray | null;
while ((m = tagRe.exec(xml))) {
  const seg = m[0];
  const kind = m[1] ?? m[2] ?? (m[0].startsWith("<line") ? "line" : m[0].startsWith("<rect") ? "rectangle" : "image");
  const pos = /<reportElement[^>]*\bx="(\d+)"[^>]*\by="(\d+)"[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(seg);
  if (!pos) continue;
  const [, x, y, w, h] = pos.map(Number) as unknown as [number, number, number, number, number];
  const txt = /<text><!\[CDATA\[([\s\S]*?)\]\]><\/text>/.exec(seg);
  const exp = /<textFieldExpression[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/textFieldExpression>/.exec(seg);
  const pat = /<pattern><!\[CDATA\[([\s\S]*?)\]\]><\/pattern>/.exec(seg);
  out.push({
    kind,
    x, y, w, h,
    text: txt ? txt[1].replace(/\n/g, " ⏎ ").trim() : undefined,
    expr: exp ? exp[1].replace(/\s+/g, " ").trim() : undefined,
    pattern: pat ? pat[1] : undefined,
  });
}

out.sort((a, b) => (a.y! - b.y!) || (a.x! - b.x!));
const lines = out.map(e =>
  `y=${String(e.y).padStart(4)} x=${String(e.x).padStart(3)} w=${String(e.w).padStart(3)} ${e.kind.padEnd(11)} ${e.text ? `TEXT: ${JSON.stringify(e.text)}` : e.expr ? `EXPR: ${e.expr}` : ""}`
);
writeFileSync("/home/z/my-project/scripts/jrxml-map.txt", lines.join("\n"));
console.log(`total elements: ${out.length}`);
console.log(`texts: ${out.filter(e => e.text).length}, exprs: ${out.filter(e => e.expr).length}`);
console.log("written scripts/jrxml-map.txt");
