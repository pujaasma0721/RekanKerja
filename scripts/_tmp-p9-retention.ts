// TEST-2 retensi: mutasi sementara periodEnd PER-2025 → run job → verifikasi → restore eksak.
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { jobPerfRetentionScan } from "@/rekankerja/performance/services/retention-service";

async function main() {
  const db = await getTenantClient("tenant_pt_mitra_industri_internasional");
  const cyc = await db.performanceCycle.findFirst({ where: { code: "PER-2025" } });
  if (!cyc) throw new Error("PER-2025 tidak ditemukan");
  console.log("PER-2025:", cyc.status, "periodEnd:", cyc.periodEnd.toISOString().slice(0, 10));
  const origEnd = cyc.periodEnd;
  // peserta PER-2025
  const parts = await db.appraisalRecord.findMany({ where: { cycleId: cyc.id }, select: { id: true, archivedAt: true } });
  console.log("peserta PER-2025:", parts.length);

  // 1) run job TANPA mutasi — harus 0 (periodEnd 2025 > cutoff)
  const r0 = await jobPerfRetentionScan(db);
  console.log("run#1 (tanpa mutasi): archived =", r0.archived, "(harus 0)");

  // 2) mutasi: periodEnd ke 2019 → run → semua peserta PER-2025 harus terarsip
  await db.performanceCycle.update({ where: { id: cyc.id }, data: { periodEnd: new Date("2019-12-31T00:00:00.000Z") } });
  const r1 = await jobPerfRetentionScan(db);
  const archivedNow = await db.appraisalRecord.count({ where: { cycleId: cyc.id, archivedAt: { not: null } } });
  console.log("run#2 (periodEnd 2019): archived =", r1.archived, "| terarsip PER-2025 =", archivedNow, `(harus ${parts.length})`);

  // 3) idempoten: run ulang → 0 baru
  const r2 = await jobPerfRetentionScan(db);
  console.log("run#3 (idempoten): archived =", r2.archived, "(harus 0)");

  // 4) restore eksak
  await db.appraisalRecord.updateMany({ where: { cycleId: cyc.id }, data: { archivedAt: null } });
  await db.performanceCycle.update({ where: { id: cyc.id }, data: { periodEnd: origEnd } });
  const back = await db.performanceCycle.findUnique({ where: { id: cyc.id }, select: { periodEnd: true } });
  const archBack = await db.appraisalRecord.count({ where: { cycleId: cyc.id, archivedAt: { not: null } } });
  console.log("restore: periodEnd =", back?.periodEnd.toISOString().slice(0, 10), "(harus", origEnd.toISOString().slice(0, 10) + ")", "| archived tersisa =", archBack, "(harus 0)");

  const ok = r0.archived === 0 && r1.archived === parts.length && r2.archived === 0 && archBack === 0 && back?.periodEnd.getTime() === origEnd.getTime();
  console.log(ok ? "TEST-2 RETENSI: LULUS" : "TEST-2 RETENSI: GAGAL");
  process.exit(ok ? 0 : 1);
}
main();
