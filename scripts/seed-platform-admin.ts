// RekanKerja — bootstrap akun PEMILIK APLIKASI (realm PlatformAdmin). ========
// =====================================================================
// FEAT-SUPPORT-P5-SEC: konsol Platform Admin memakai realm identitas &
// sesi MANDIRI (tabel PlatformAdmin di public schema — tidak ada hubungan
// dengan User platform / membership tenant / AppUser tenant). Akun ini
// adalah SATU-SATUNYA cara masuk konsol pemilik aplikasi.
//
// Pemakaian:
//   bun scripts/seed-platform-admin.ts                       # dev default
//   PLATFORM_ADMIN_EMAIL=ops@rekankerja.id \
//   PLATFORM_ADMIN_PASSWORD='<kuat-32+>' \
//   PLATFORM_ADMIN_NAME='Nama Pemilik' bun scripts/seed-platform-admin.ts
//
// Idempoten: akun yang sudah ada tidak ditimpa. Ganti sandi pemilik
// aplikasi kelak dilakukan lewat endpoint konsol (versi berikutnya) atau
// skrip ops terkontrol — JANGAN pernah mengubah passwordHash manual.
import { db } from "../src/lib/db";
import { hashPassword } from "../src/rekankerja/shared/lib/auth";

async function main() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL ?? "owner@rekankerja.id").toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "onevity123";
  const name = process.env.PLATFORM_ADMIN_NAME ?? "Pemilik RekanKerja";
  if (!process.env.PLATFORM_ADMIN_PASSWORD && process.env.NODE_ENV === "production") {
    throw new Error("Produksi wajib PLATFORM_ADMIN_PASSWORD eksplisit — jangan pakai default dev.");
  }
  const existing = await db.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log(`PlatformAdmin ${email} sudah ada — dilewati (idempoten).`);
    return;
  }
  await db.platformAdmin.create({ data: { email, name, passwordHash: hashPassword(password) } });
  console.log(`PlatformAdmin dibuat: ${email} — realm mandiri, bukan member tenant mana pun.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
