// RekanKerja — generate demo employee portrait photos (Task 26)
// For each MII employee: AI headshot → sharp 320×320 JPEG → public/avatars/{employeeNo}.jpg
// Then seed Employee.photoUrl. Idempotent: skip existing files.
import ZAI from "z-ai-web-dev-sdk";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { PrismaClient as Tenant } from "../src/generated/tenant";

const AVATAR_DIR = path.join(process.cwd(), "public", "avatars");
const SCHEMA = "tenant_pt_mitra_industri_internasional";

// Indonesian female first-name heuristics (DB gender field is noisy)
const FEMALE_HINTS = ["sri", "tri", "dewi", "rina", "siti", "nur", "endang", "wati", "yuni", "rahma", "fitri", "indah", "sriwahyu", "ratna", "dwi", "lina", "wulan", "sari", "ayu", "puji", "ani", "yanti", "lestari", "harni", "mey", "nova", "vina", "tari", "utami", "ambar"];
const isFemale = (fullName: string, dbGender: string) => {
  const first = fullName.split(" ")[0].toLowerCase();
  if (FEMALE_HINTS.includes(first)) return true;
  if (["bambang", "joko", "agus", "dedi", "hartono", "slamet", "wahyu", "eko", "sutar", "sugeng", "budi", "agus", "prayitno", "rudi", "andri", "fajar", "gilang", "bagus", "adip", "teguh"].includes(first)) return false;
  return dbGender === "F";
};

// deterministic variety per index
const attire = (i: number) => ["white shirt", "light blue shirt", "navy suit with tie", "batik shirt", "gray blazer over blouse", "formal office shirt"][i % 6];
const ageVar = (i: number) => 27 + ((i * 7) % 29); // 27–55
const extra = (i: number) => (i % 3 === 0 ? ", wearing glasses" : "") + (i % 5 === 0 ? ", friendly confident smile" : ", subtle smile");

async function main() {
  // sharding paralel: `bun run scripts/gen-employee-photos.ts <shard>/<total>` (default 0/1)
  const [shardArg, totalArg] = (process.argv[2] ?? "0/1").split("/");
  const shard = Number(shardArg) || 0;
  const shardTotal = Number(totalArg) || 1;

  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const db = new Tenant({ datasources: { db: { url: `${process.env.TENANT_DB_BASE_URL}?schema=${SCHEMA}` } } });
  const empsAll = await db.employee.findMany({ select: { id: true, employeeNo: true, fullName: true, gender: true, photoUrl: true }, orderBy: { employeeNo: "asc" } });
  const emps = empsAll.filter((_, i) => i % shardTotal === shard);
  console.log(`[shard ${shard}/${shardTotal}] employees: ${emps.length}, existing files: ${fs.readdirSync(AVATAR_DIR).length}`);

  const zai = await ZAI.create();
  let done = 0, failed = 0;
  for (let i = 0; i < emps.length; i++) {
    const e = emps[i];
    const gi = empsAll.findIndex((x) => x.id === e.id); // index global utk variasi atribut konsisten
    const out = path.join(AVATAR_DIR, `${e.employeeNo}.jpg`);
    if (fs.existsSync(out)) { done++; continue; }
    const female = isFemale(e.fullName, e.gender);
    const prompt = [
      `Professional corporate headshot portrait of an Indonesian ${female ? "woman" : "man"}, approximately ${ageVar(gi)} years old,`,
      `wearing ${female ? ["modest professional office blouse", "blazer with hijab", "formal office attire", "professional shirt with hijab"][gi % 4] : attire(gi)},`,
      `natural skin tone, ${extra(gi)},`,
      "soft diffused studio lighting, clean light neutral background, head and shoulders framing, photorealistic, sharp focus, high quality photography",
    ].join(" ");
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await zai.images.generations.create({ prompt, size: "1024x1024" });
        const b64 = res.data?.[0]?.base64;
        if (!b64) throw new Error("empty base64");
        const buf = await sharp(Buffer.from(b64, "base64")).resize(320, 320, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
        fs.writeFileSync(out, buf);
        ok = true;
      } catch (err) {
        console.log(`retry ${attempt} for ${e.employeeNo}: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (ok) done++; else { failed++; console.log(`FAILED ${e.employeeNo} ${e.fullName}`); }
  }

  // seed photoUrl for all employees that have a file
  let seeded = 0;
  for (const e of emps) {
    const out = path.join(AVATAR_DIR, `${e.employeeNo}.jpg`);
    const url = `/avatars/${e.employeeNo}.jpg`;
    if (fs.existsSync(out) && e.photoUrl !== url) {
      await db.employee.update({ where: { id: e.id }, data: { photoUrl: url } });
      seeded++;
    }
  }
  console.log(`DONE generated=${done} failed=${failed} seeded=${seeded}`);
  await db.$disconnect();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
