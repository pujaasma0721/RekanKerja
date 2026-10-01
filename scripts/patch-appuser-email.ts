// One-off patch (Task 24 — audit bisnis proses): samakan email AppUser MII000001
// dengan akun platform demo (hrd@mii.co.id) agar resolusi aktor sesi
// (requireMutator → actor.appUsername) menemukan AppUser yang benar.
// Idempoten: hanya update bila berbeda. Jalankan: bun run scripts/patch-appuser-email.ts
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const u = await db.appUser.findUnique({ where: { username: "MII000001" } });
  if (!u) {
    console.log("SKIP: AppUser MII000001 tidak ditemukan");
    return;
  }
  if (u.email === "hrd@mii.co.id") {
    console.log("OK: email MII000001 sudah hrd@mii.co.id");
    return;
  }
  await db.appUser.update({ where: { id: u.id }, data: { email: "hrd@mii.co.id" } });
  console.log("PATCHED: MII000001 email → hrd@mii.co.id");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
