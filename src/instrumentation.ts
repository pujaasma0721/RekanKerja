// OneVity instrumentation — hook startup Next.js (dipanggil sekali per proses
// server). Dipakai untuk AUTO-SEED demo: bila database platform masih KOSONG
// (belum ada tenant sama sekali) → jalankan scripts/restore-demo.ts di latar
// belakang sehingga deployment baru langsung punya data demo 3 tenant
// (MII penuh + Cahaya + Sentra) persis seperti environment lokal sandbox.
//
// Guard:
// - hanya runtime nodejs (bukan edge)
// - tidak saat `next build` (phase-production-build)
// - matikan via env DEMO_AUTOSEED=off
// - hanya bila Tenant count == 0 (tidak pernah menyentuh DB berdata)
// - restore-demo idempoten → aman bila proses restart di tengah seed
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DEMO_AUTOSEED === "off") return;
  try {
    const { platformCounts, spawnRestoreDemo } = await import("./onevity/shared/lib/demo-seed");
    const { tenants } = await platformCounts();
    if (tenants > 0) return; // sudah ada data — jangan sentuh apa pun
    console.log("[demo-seed] database kosong — restore demo 3 tenant dimulai di latar belakang…");
    const r = spawnRestoreDemo();
    console.log(`[demo-seed] ${r.note}`);
    if (!r.ok) console.warn("[demo-seed] auto-seed tidak jalan — jalankan manual: bun scripts/restore-demo.ts");
  } catch (e) {
    // platform DB belum siap / tabel belum ada → diam (deployment pertama sebelum db:push)
    console.warn(`[demo-seed] lewati auto-seed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
