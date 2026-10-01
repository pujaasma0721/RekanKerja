// RekanKerja instrumentation — hook startup Next.js (dipanggil sekali per proses
// server). Tiga fungsi (rev Task 30 / seed-remote wave):
// 1. AUTO-SEED demo FRESH: bila database platform masih KOSONG (belum ada
//    tenant) → seed demo 3 tenant (MII penuh + Cahaya + Sentra) di latar
//    belakang — deployment baru langsung punya data persis sandbox.
// 2. AUTO-PARITY UPGRADE (BARU): bila tenant SUDAH ada tapi struktur
//    wave-26/27/28 belum lengkap (deployment lama yang baru pull kode baru —
//    DB masih skema lama) → jalankan parity runner IN-PROCESS di latar
//    belakang. Ini menyehatkan kondisi transisional "kode baru + DB lama"
//    (mis. payroll error type mismatch) TANPA perintah manual: cukup
//    pull → build → restart.
// 3. BACKGROUND JOB SCHEDULER (T14-SCHED): nyalakan scheduler lintas tenant
//    (siklus tiap 6 jam + run pertama 60 dtk) — resign terjadwal, pengingat
//    kontrak/probation/dokumen, SLA approval, payroll D-3, housekeeping.
//
// Guard:
// - hanya runtime nodejs (bukan edge)
// - tidak saat `next build` (phase-production-build)
// - matikan via env DEMO_AUTOSEED=off / SCHEDULER=off
// - parity runner idempoten → aman bila proses restart di tengah jalan
//   (rerun = no-op; gap check murah hanya 2 query information_schema)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    if (process.env.DEMO_AUTOSEED !== "off") {
      const { platformCounts, startDemoSeed } = await import("./rekankerja/shared/lib/demo-seed");
      const { checkParityGap } = await import("./rekankerja/shared/lib/parity-runner");
      const counts = await platformCounts();
      if (counts.tenants === 0) {
        console.log("[demo-seed] database kosong — restore demo 3 tenant dimulai di latar belakang…");
        const r = startDemoSeed();
        console.log(`[demo-seed] ${r.note}`);
        if (!r.ok) console.warn("[demo-seed] auto-seed tidak jalan — jalankan manual: bun scripts/restore-demo.ts");
      } else {
        // tenant ada — pastikan DB sudah paritas dgn kode yang berjalan
        const gap = await checkParityGap();
        if (gap.gap) {
          console.log(
            `[demo-seed] gap parity terdeteksi (${gap.readySchemas}/${gap.tenants} tenant siap — ${gap.reasons.join("; ")}) — migrasi upgrade dimulai di latar belakang…`,
          );
          const r = startDemoSeed({ parityOnly: true });
          console.log(`[demo-seed] ${r.note}`);
        } else {
          console.log(`[demo-seed] ${gap.tenants} tenant sudah paritas — tidak ada tindakan.`);
        }
      }
    }
  } catch (e) {
    // platform DB belum siap / tabel belum ada → diam (deployment pertama sebelum db:push)
    console.warn(`[demo-seed] lewati auto-seed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // T14-SCHED: scheduler latar belakang (guard lengkap di initScheduler:
    // nodejs-only, bukan next build, SCHEDULER=off, idempoten per proses).
    try {
      const { initScheduler } = await import("./rekankerja/shared/services/scheduler-service");
      initScheduler();
    } catch (e) {
      console.warn(`[scheduler] gagal diinisialisasi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Task 47: muat dataKey vault (kunci kata sandi perusahaan) semua tenant ke
  // cache field-crypto saat boot — scheduler/background job membaca field
  // terenkripsi SEBELUM request pertama (prime per-request hanya menutup
  // jalur HTTP). Best-effort: DB belum siap → request path mengulang prime.
  try {
    const { primeAllTenantCrypto } = await import("./rekankerja/shared/lib/field-crypto");
    const n = await primeAllTenantCrypto();
    if (n > 0) console.log(`[field-crypto] kunci vault ${n} tenant termuat`);
  } catch {
    // diam — jalur request akan prime ulang
  }
}

