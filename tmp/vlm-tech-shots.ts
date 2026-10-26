import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";
async function main() {
  const zai = await ZAI.create();
  for (const f of ["shot-login", "shot-dashboard", "shot-attendance-live"]) {
    const b64 = readFileSync(`download/slides/${f}.png`).toString("base64");
    const r = await zai.chat.completions.create({
      messages: [{ role: "user", content: [
        { type: "text", text: "Deskripsikan singkat screenshot aplikasi ini (bahasa Indonesia, 2-3 kalimat): apa halamannya, apakah data tampil lengkap (bukan skeleton/loading/kosong), ada error visual?" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ]}],
    });
    console.log(`=== ${f} ===`);
    console.log(r.choices[0]?.message?.content?.slice(0, 400));
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
