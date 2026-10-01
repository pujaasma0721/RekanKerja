// Jalankan pipeline parity SEKALI dari CLI (verifikasi lokal):
// PLATFORM_DB_URL=... TENANT_DB_BASE_URL=... bun scripts/run-parity-once.ts
// (parity-runner juga berjalan otomatis in-process saat server boot bila gap.)
import "./lib/env";

const { runParityPipeline } = await import("@/rekankerja/shared/lib/parity-runner");
const rep = await runParityPipeline((l) => console.log(l));
console.log(`\nparity ok=${rep.ok} — ${rep.steps.length} langkah`);
if (rep.remainingGap?.length) console.log(`sisa gap: ${rep.remainingGap.join("; ")}`);
process.exit(rep.ok ? 0 : 1);
