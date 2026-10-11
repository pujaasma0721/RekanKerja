import { PrismaClient } from "@/generated/tenant";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { TENANT_SCHEMA_BRAND } from "@/rekankerja/shared/lib/field-crypto";
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";

const db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_BASE_URL! + "?schema=tenant_pt_mitra_industri_internasional" } } } as never);
Object.defineProperty(db, TENANT_SCHEMA_BRAND, { value: "tenant_pt_mitra_industri_internasional", enumerable: false });
const tc = tenantCryptoForDb(db as never);
const apps = await db.applicant.findMany({ include: { skills: { include: { skill: true } }, experiences: true, educations: true } });
for (const a of apps) {
  console.log(a.applicantNo, "|", a.firstName, a.lastName, "| city:", tc.decryptText(a.city), "| expMonths:", a.totalExpMonths, "| edu:", a.highestEduLevel, "| sal:", tc.decryptMoney(a.expectedSalary));
  for (const e of a.experiences) console.log("   exp:", e.position, "@", e.company, e.startYear, "-", e.endYear);
  for (const e of a.educations) console.log("   edu:", e.level, e.fieldOfStudy, e.institution);
}
const zai = await createZaiClient();
const completion = await zai.chat.completions.create({ messages: [
  { role: "assistant", content: 'Deteksi frasa berpotensi diskriminatif/bias dalam teks lowongan. Output HANYA JSON {"findings":[{"phrase":"","issue":"gender|age|appearance|status|fisik|lainnya","suggestion":"pengganti netral"}]}' },
  { role: "user", content: "Dicari pria muda di bawah 30 tahun, menarik, belum menikah, tinggi minimal 170" },
], thinking: { type: "disabled" } });
console.log("\n=== RAW CHECK-BIAS AI ===\n", completion.choices[0]?.message?.content);
await db.$disconnect();
