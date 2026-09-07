// Re-sync LetterTemplate rows to current letter-defaults (seeded sebelum polish frasa)
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { LETTER_TEMPLATE_DEFAULTS } from "@/onevity/shared/lib/letter-defaults";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];
for (const schema of SCHEMAS) {
  const db = getTenantClient(schema);
  let n = 0;
  for (const t of LETTER_TEMPLATE_DEFAULTS) {
    const r = await db.letterTemplate.updateMany({
      where: { key: t.key },
      data: { name: t.name, description: t.description ?? null, subject: t.subject ?? null, body: t.body, signatoryTitle: t.signatoryTitle },
    });
    n += r.count;
  }
  console.log(`${schema}: ${n} template di-update ke default terbaru`);
  await db.$disconnect();
}
