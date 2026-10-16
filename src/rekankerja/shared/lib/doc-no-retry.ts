// RekanKerja — retry unique-constraint utk penomoran dokumen (REC-AUDIT-FIX) =
// ===========================================================================
// L2 audit rekrutmen: nomor dokumen (PR-/JO-/OFF-/APP-…/NNN/HR-RC/…) dihitung
// dengan scan max-suffix + 1 TANPA lock — dua create bersamaan bisa mendapat
// nomor sama → salah satunya gagal P2002 di tengah proses bisnis. Helper ini
// mengulang SELURUH make() (yang menghitung nomor BARU tiap percobaan) bila
// kegagalan disebabkan unique-constraint; percobaan lain dibiarkan lempar.
//
// Batas default 5 percobaan — jendela race pendek; kemungkinan bertabrakan
// lagi setelah nomor baru dihitung mengecil drastis. Tanpa DB lock/advisory
// lock (keputusan arsitektur: single-node, tanpa middleware baru).

/** true bila error adalah pelanggaran unique-constraint Prisma (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2002") return true;
  const msg = String((e as Error | null)?.message ?? "");
  return msg.includes("Unique constraint failed");
}

/**
 * Jalankan make() ulang (maks `maxAttempts`) selama gagal karena unique-
 * constraint — nomor dokumen dihitung ulang oleh make() pada tiap percobaan.
 * Semua jenis error lain langsung di-lempar ke pemanggil.
 */
export async function retryOnUnique<T>(make: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await make();
    } catch (e) {
      last = e;
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw last;
}
