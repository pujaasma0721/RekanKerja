// Re-sync LetterTemplate rows ke letter-defaults terbaru — TIDAK menimpa edit
// pengguna (26-a): template baru dibuat bila belum ada; template lama hanya
// diperbarui bila belum pernah diedit lewat UI (updatedAt masih ≈ createdAt
// sejak seeding). Baris yang sudah diedit admin dibiarkan apa adanya.
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { LETTER_TEMPLATE_DEFAULTS } from "@/onevity/shared/lib/letter-defaults";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** Baris belum pernah diedit pengguna? (updatedAt masih menempel ke createdAt seeding). */
function untouched(row: { createdAt: Date; updatedAt: Date }): boolean {
  return Math.abs(row.updatedAt.getTime() - row.createdAt.getTime()) < 1500;
}

for (const schema of SCHEMAS) {
  const db = getTenantClient(schema);
  let created = 0;
  let refreshed = 0;
  let skipped = 0;
  for (const t of LETTER_TEMPLATE_DEFAULTS) {
    const row = await db.letterTemplate.findUnique({
      where: { key: t.key },
      select: { id: true, createdAt: true, updatedAt: true, body: true },
    });
    if (!row) {
      // template baru (mis. 5 surat layanan EMP_* 26-a) → seed
      await db.letterTemplate.create({
        data: {
          key: t.key,
          category: t.category,
          name: t.name,
          description: t.description ?? null,
          subject: t.subject ?? null,
          body: t.body,
          signatoryTitle: t.signatoryTitle,
        },
      });
      created++;
      continue;
    }
    if (untouched(row)) {
      // belum pernah diedit → refresh ke default terbaru (pola resync lama)
      await db.letterTemplate.update({
        where: { id: row.id },
        data: {
          name: t.name,
          description: t.description ?? null,
          subject: t.subject ?? null,
          body: t.body,
          signatoryTitle: t.signatoryTitle,
        },
      });
      refreshed++;
    } else {
      skipped++; // sudah diedit admin — jangan ditimpa
    }
  }
  console.log(`${schema}: ${created} template baru, ${refreshed} di-refresh, ${skipped} dibiarkan (sudah diedit)`);
  await db.$disconnect();
}
