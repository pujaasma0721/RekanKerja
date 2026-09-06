// OneVity instrumentation — hook startup Next.js (dipanggil sekali per proses
// server). Dua fungsi (rev T14):
// 1. AUTO-SEED demo: bila database platform masih KOSONG (belum ada tenant
//    sama sekali) → jalankan scripts/restore-demo.ts di latar belakang
//    sehingga deployment baru langsung punya data demo 3 tenant
//    (MII penuh + Cahaya + Sentra) persis seperti environment lokal sandbox.
// 2. BACKGROUND JOB SCHEDULER (T14-SCHED): nyalakan scheduler lintas tenant
//    (siklus tiap 6 jam + run pertama 60 dtk) — resign terjadwal, pengingat
//    kontrak/probation/dokumen, SLA approval, payroll D-3, housekeeping.
//
// Guard:
// - hanya runtime nodejs (bukan edge)
// - tidak saat `next build` (phase-production-build)
// - matikan via env DEMO_AUTOSEED=off / SCHEDULER=off
// - auto-seed hanya bila Tenant count == 0 (tidak pernah menyentuh DB berdata)
// - restore-demo idempoten → aman bila proses restart di tengah seed
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    if (process.env.DEMO_AUTOSEED !== "off") {
      const { platformCounts, spawnRestoreDemo } = await import("./onevity/shared/lib/demo-seed");
      const { tenants } = await platformCounts();
      if (tenants > 0) return; // sudah ada data — jangan sentuh apa pun
      console.log("[demo-seed] database kosong — restore demo 3 tenant dimulai di latar belakang…");
      const r = spawnRestoreDemo();
      console.log(`[demo-seed] ${r.note}`);
      if (!r.ok) console.warn("[demo-seed] auto-seed tidak jalan — jalankan manual: bun scripts/restore-demo.ts");
    }
  } catch (e) {
    // platform DB belum siap / tabel belum ada → diam (deployment pertama sebelum db:push)
    console.warn(`[demo-seed] lewati auto-seed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // T14-SCHED: scheduler latar belakang (guard lengkap di initScheduler:
    // nodejs-only, bukan next build, SCHEDULER=off, idempoten per proses).
    try {
      const { initScheduler } = await import("./onevity/shared/services/scheduler-service");
      initScheduler();
    } catch (e) {
      console.warn(`[scheduler] gagal diinisialisasi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
