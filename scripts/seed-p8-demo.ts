// Seed data demo E2E P8-PERF (Laporan & Analitik) — idempoten. Mengisi celah
// data demo agar 14 laporan pf11–pf44 punya isi nyata (data MII saat ini:
// PER-2025 12 Closed + PER-2026-CAL 3 Closed — tanpa 360/kalibrasi/merit/band):
//   1. PER-2026 (Annual, Assessment, 360 aktif) + 8 peserta lintas atasan dengan
//      status campuran (SelfDone/ManagerDone/GoalApproved/Enrolled) + 3 KPI
//      pustaka per peserta + check-in → pf11/pf12/pf13 "siapa belum isi".
//   2. PER-2026-CAL diperkaya: KPI + kompetensi + band + acknowledge +
//      SESI KALIBRASI (2 forum: 1 forum unit + 1 sesi banding) + 4 keputusan
//      ter-audit (skor from→to + alasan + decidedBy) → pf31/pf43.
//   3. Banding: Andi Rejected + Tuti Iskandar Adjusted (52.9→60 via keputusan
//      sesi banding — pola decideAppeal P4) → pf33.
//   4. Merit VAULT 3 baris (enc:v1) lintas status Draft/Approved/Applied
//      (appliedRunNo payroll) → pf41.
//   5. Feedback360: Tuti Gunawan 4 undangan/3 submitted (agregat tampil) +
//      Andi 2 undangan/1 submitted (dirahasiakan <3) + jawaban kompetensi → pf24.
// Jalankan: bun run scripts/seed-p8-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const MII = "tenant_pt_mitra_industri_internasional";
const DAY = 24 * 3600 * 1000;
const d = (iso: string) => new Date(iso);

async function main() {
  const db = getTenantClient(MII);
  const tc = tenantCryptoForDb(db);

  const company = await db.company.findFirst({ select: { id: true, name: true } });
  if (!company) throw new Error("Company MII tidak ditemukan — jalankan restore-demo dulu");

  // ---------- referensi master ----------
  const emps = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, employeeNo: true, fullName: true, orgUnitId: true },
  });
  const emp = (no: string) => emps.find((e) => e.employeeNo === no);
  const tri = emp("MII00004"); // Tri Handayani — OWNER demo (chair kalibrasi)
  const bambang = emp("MII00003");
  const jokoS = emps.find((e) => e.fullName === "Joko Susilo");
  const dewi = emps.find((e) => e.fullName === "Dewi Anggraini");
  if (!tri || !bambang || !jokoS || !dewi) throw new Error("Karyawan kunci demo tidak ditemukan");

  const kpiDefs = await db.kpiDefinition.findMany({
    where: { active: true, status: "Active" },
    select: { id: true, code: true, name: true, category: true, polarity: true, unit: true, sourceKey: true, dataSource: true },
  });
  const kd = (code: string) => kpiDefs.find((k) => k.code === code);
  const comps = await db.competency.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true },
  });
  const matrix = await db.meritMatrix.findFirst({ where: { active: true }, select: { id: true, code: true } });

  // =========================================================
  // (2-4) PER-2026-CAL diperkaya — dijalankan dulu (data lama)
  // =========================================================
  const cal = await db.performanceCycle.findFirst({ where: { code: "PER-2026-CAL" } });
  if (!cal) throw new Error("PER-2026-CAL tidak ditemukan — jalankan seed-p6-demo dulu");
  await db.performanceCycle.update({ where: { id: cal.id }, data: { feedback360: true } });

  const calApprs = await db.appraisalRecord.findMany({
    where: { cycleId: cal.id },
    select: { id: true, docNo: true, employeeId: true, managerId: true, employee: { select: { employeeNo: true, fullName: true } } },
  });
  const tutiG = calApprs.find((a) => a.employee.employeeNo === "MII00013"); // Tuti Gunawan
  const andi = calApprs.find((a) => a.employee.employeeNo === "MII00041"); // Andi Tanaka
  const tutiI = calApprs.find((a) => a.employee.employeeNo === "MII00028"); // Tuti Iskandar
  if (!tutiG || !andi || !tutiI) throw new Error("Appraisal PER-2026-CAL tidak lengkap (seed-p6)");

  // --- KPI snapshot per appraisal CAL (utk pf13/pf23 detail siklus) ---
  const kpiSpec = [
    { code: "IPR-PRESENCE", target: 98, thr: 90, stretch: 100, weight: 40 },
    { code: "CUS-RETENTION", target: 90, thr: 80, stretch: 95, weight: 30 },
    { code: "LNG-TALENT-READY", target: 80, thr: 70, stretch: 90, weight: 30 },
  ];
  for (const a of [tutiG, andi, tutiI]) {
    const have = await db.appraisalKpi.count({ where: { appraisalId: a.id } });
    if (have > 0) { console.log(`[KPI] ${a.docNo} sudah ${have} baris — skip`); continue; }
    let i = 0;
    for (const s of kpiSpec) {
      const def = kd(s.code);
      i++;
      await db.appraisalKpi.create({
        data: {
          appraisalId: a.id, kpiDefId: def?.id ?? null,
          title: def?.name ?? `KPI ${i}`, polarity: def?.polarity ?? "Higher", unit: def?.unit ?? "%",
          thresholdMin: s.thr, target: s.target, stretchValue: s.stretch, weight: s.weight,
          isCritical: false, dataSource: def?.dataSource ?? "Manual",
          midActual: s.target - 4 + i,
          finalActual: s.target - 2 + i * 2,
          origin: def ? "Template" : "Fresh", proposedBy: "Manager",
        },
      });
    }
  }

  // --- kompetensi per appraisal CAL (utk pf23) ---
  if ((await db.appraisalCompetencyScore.count({ where: { appraisalId: { in: [tutiG.id, andi.id, tutiI.id] } } })) === 0) {
    for (const [ai, a] of [tutiG, andi, tutiI].entries()) {
      for (const [ci, c] of comps.slice(0, 4).entries()) {
        await db.appraisalCompetencyScore.create({
          data: {
            appraisalId: a.id, competencyId: c.id,
            score: Math.min(5, 3 + ((ai + ci) % 3)),
            selfScore: Math.min(5, 3 + ((ai + ci + 1) % 3)),
          },
        });
      }
    }
  } else {
    console.log("[COMP] skor kompetensi CAL sudah ada — skip");
  }

  // --- 360 (pf24): Tuti Gunawan 4 undangan/3 submitted; Andi 2/1 (dirahasiakan) ---
  if ((await db.feedback360.count({ where: { appraisalId: { in: [tutiG.id, andi.id] } } })) === 0) {
    const reviewers = [
      { appraisal: tutiG, reviewer: emp("MII00018"), type: "Peer", status: "Submitted", days: 20 },
      { appraisal: tutiG, reviewer: emp("MII00019"), type: "Peer", status: "Submitted", days: 18 },
      { appraisal: tutiG, reviewer: emp("MII00022"), type: "Subordinate", status: "Submitted", days: 15 },
      { appraisal: tutiG, reviewer: bambang, type: "Upward", status: "Invited", days: 0 },
      { appraisal: andi, reviewer: emp("MII00020"), type: "Peer", status: "Submitted", days: 12 },
      { appraisal: andi, reviewer: dewi, type: "Upward", status: "Declined", days: 0 },
    ];
    for (const r of reviewers) {
      if (!r.reviewer) continue;
      const f = await db.feedback360.create({
        data: {
          appraisalId: r.appraisal.id, reviewerId: r.reviewer.id, reviewerType: r.type,
          status: r.status, dueAt: d("2026-09-20"),
          submittedAt: r.status === "Submitted" ? d(`2026-09-${String(r.days).padStart(2, "0")}`) : null,
        },
      });
      if (r.status === "Submitted") {
        for (const [ci, c] of comps.slice(0, 4).entries()) {
          await db.feedback360Answer.create({
            data: { feedbackId: f.id, competencyId: c.id, score: 3 + ((ci + f.id.length) % 3) },
          });
        }
      }
    }
    console.log("[360] 6 undangan dibuat (Tuti 4/3 submitted · Andi 2/1)");
  } else {
    console.log("[360] undangan sudah ada — skip");
  }

  // --- sesi kalibrasi + keputusan ter-audit (pf31) ---
  if ((await db.calibrationSession.count({ where: { cycleId: cal.id } })) === 0) {
    const forum = await db.calibrationSession.create({
      data: {
        cycleId: cal.id, orgUnitId: null, heldAt: d("2026-09-24T09:00:00"),
        participantsJson: JSON.stringify({ participants: [tri.id, bambang.id, jokoS!.id, dewi.id], closedAt: new Date(Date.now() - 20 * DAY).toISOString(), closedBy: tri.id }),
        chairId: tri.id,
        notes: "Forum penyetaraan standar lintas atasan — skor final selaras bukti capaian.",
      },
    });
    const appealSession = await db.calibrationSession.create({
      data: {
        cycleId: cal.id, orgUnitId: null, heldAt: d("2026-09-28T14:00:00"),
        participantsJson: JSON.stringify({ participants: [tri.id] }),
        chairId: tri.id, notes: "Sesi banding — putusan final atas banding karyawan.",
      },
    });
    const mkDecision = async (sessionId: string, appraisalId: string, o: { oldScore: number; newScore: number; oldRating: number; newRating: number; band?: number; reason: string }) =>
      db.calibrationDecision.create({
        data: {
          sessionId, appraisalId, oldScore: o.oldScore, newScore: o.newScore,
          oldRating: o.oldRating, newRating: o.newRating, potentialBand: o.band ?? null,
          reason: o.reason, decidedBy: tri.fullName ?? "Tri Handayani", decidedAt: d("2026-09-24T11:30:00"),
        },
      });
    await mkDecision(forum.id, tutiG.id, { oldScore: 48.2, newScore: 55, oldRating: 2, newRating: 2, band: 2, reason: "Bukti capaian lintas-KPI (kehadiran 98%, retensi klien 89%) lebih tinggi dari skor awal — disetara dgn tim sejenis." });
    await mkDecision(forum.id, andi.id, { oldScore: 52.7, newScore: 62, oldRating: 2, newRating: 2, band: 3, reason: "Potensi pengembangan tinggi (band 3) — capaian teknis kuat, koreksi skor utk kewajaran antar tim." });
    await mkDecision(forum.id, tutiI.id, { oldScore: 44.9, newScore: 52.9, oldRating: 2, newRating: 2, band: 2, reason: "Koreksi leniency check atasan — capaian riil di bawah target pada 2 KPI namun membaik pada kuartal terakhir." });
    await mkDecision(appealSession.id, tutiI.id, { oldScore: 52.9, newScore: 60, oldRating: 2, newRating: 3, reason: "BANDING DISETUJUI — bukti tambahan (berkas capaian Q3) menunjukkan realisasi di atas yang tercatat; skor disesuaikan 52.9 → 60." });
    console.log("[CALIB] 2 sesi + 4 keputusan ter-audit dibuat");
  } else {
    console.log("[CALIB] sesi sudah ada — skip");
  }

  // --- finalisasi nilai CAL pasca-keputusan + band + ack + banding (pf21/pf33/pf43) ---
  await db.appraisalRecord.update({ where: { id: tutiG.id }, data: { finalScore: 55, finalRating: 2, potentialBand: 2, acknowledgedAt: d("2026-10-02T08:15:00") } });
  await db.appraisalRecord.update({ where: { id: andi.id }, data: { finalScore: 62, finalRating: 2, potentialBand: 3, appealStatus: "Rejected", appealNote: "Menurut saya capaian kehadiran & retensi lebih tinggi dari catatan atasan — mohon tinjauan ulang.", appealDecidedBy: tri.fullName ?? "Tri Handayani", appealDecidedAt: d("2026-09-30T10:00:00") } });
  await db.appraisalRecord.update({ where: { id: tutiI.id }, data: { finalScore: 60, finalRating: 3, potentialBand: 2, appealStatus: "Adjusted", appealNote: "Bukti capaian Q3 (berkas terlampir) belum diperhitungkan dalam skor atasan.", appealDecidedBy: tri.fullName ?? "Tri Handayani", appealDecidedAt: d("2026-09-28T15:00:00") } });

  // --- merit VAULT 3 baris (pf41) ---
  if ((await db.meritRecommendation.count()) === 0) {
    await db.meritRecommendation.create({
      data: {
        docNo: "MER-2026-0001", appraisalId: tutiG.id, matrixId: matrix?.id ?? null,
        bonusMonths: 0.5, bonusAmount: tc.encryptMoney(2_750_000),
        raisePct: 1.5, raiseAmount: tc.encryptMoney(98_250),
        note: "Rating 2 — bonus setengah bulan + kenaikan 1,5% (matriks MERIT-STD).",
        status: "Applied", appliedRunNo: "PR-2026-09-BON-01",
      },
    });
    await db.meritRecommendation.create({
      data: {
        docNo: "MER-2026-0002", appraisalId: andi.id, matrixId: matrix?.id ?? null,
        bonusMonths: 0.5, bonusAmount: tc.encryptMoney(3_100_000),
        raisePct: 1.5, raiseAmount: tc.encryptMoney(120_000),
        note: "Rating 2 dengan band potensi 3 — koreksi kalibrasi dipertimbangkan C&B.",
        status: "Approved",
      },
    });
    await db.meritRecommendation.create({
      data: {
        docNo: "MER-2026-0003", appraisalId: tutiI.id, matrixId: matrix?.id ?? null,
        bonusMonths: 1, bonusAmount: tc.encryptMoney(5_100_000),
        raisePct: 3, raiseAmount: tc.encryptMoney(153_000),
        note: "Rating 3 pasca-banding disetujui — draf menunggu submit.",
        status: "Draft",
      },
    });
    console.log("[MERIT] 3 usulan vault (enc:v1) dibuat");
  } else {
    console.log("[MERIT] sudah ada — skip");
  }

  // =========================================================
  // (1) PER-2026 — siklus AKTIF (Assessment) utk pf11/pf12/pf13
  // =========================================================
  let active = await db.performanceCycle.findFirst({ where: { code: "PER-2026" } });
  if (active) {
    console.log(`[CYCLE] PER-2026 sudah ada (${active.status}) — skip`);
  } else {
    active = await db.performanceCycle.create({
      data: {
        code: "PER-2026", name: "Penilaian Kinerja Tahunan 2026", cycleType: "Annual",
        periodStart: d("2026-01-01"), periodEnd: d("2026-12-31"),
        goalStart: d("2026-01-05"), goalEnd: d("2026-02-15"),
        midStart: d("2026-06-01"), midEnd: d("2026-06-30"),
        selfStart: d("2026-10-01"), selfEnd: d("2026-11-15"),
        mgrStart: d("2026-11-16"), mgrEnd: d("2026-12-10"),
        calibStart: d("2026-12-11"), calibEnd: d("2026-12-20"),
        weightsJson: JSON.stringify({ kpi: 70, competency: 20, core: 10 }),
        feedback360: true, status: "Assessment", createdBy: tri.id,
      },
    });
    console.log("[CYCLE] PER-2026 Assessment dibuat");
  }

  // peserta: 8 karyawan lintas atasan + status campuran (cerita pf12)
  const roster = [
    { no: "MII00009", mgr: "MII00004", status: "SelfDone", self: 84 },       // Dedi Mahendra
    { no: "MII00010", mgr: "MII00004", status: "ManagerDone", self: 88, mgrScore: 90.5 }, // Yusuf Rahayu
    { no: "MII00011", mgr: "MII00004", status: "SelfDone", self: 79 },       // Dewi Halim
    { no: "MII00012", mgr: "MII00004", status: "Enrolled" },                 // Joko Lubis — belum isi
    { no: "MII00018", mgr: jokoS?.employeeNo ?? "", status: "GoalApproved" },// Ayu Yulianti — belum isi
    { no: "MII00019", mgr: jokoS?.employeeNo ?? "", status: "Enrolled" },    // Putri Ramadhan — belum isi
    { no: "MII00020", mgr: jokoS?.employeeNo ?? "", status: "SelfDone", self: 86 }, // Citra Kurnia
    { no: "MII00021", mgr: jokoS?.employeeNo ?? "", status: "Enrolled" },    // Wahyu Saputra — belum isi
  ];
  let seq = 0;
  for (const r of roster) {
    const e = emp(r.no);
    const mgr = emp(r.mgr);
    if (!e || !mgr) { console.log(`[ENROLL] ${r.no} / atasan ${r.mgr} tak ditemukan — lewati`); continue; }
    seq++;
    const exists = await db.appraisalRecord.findFirst({ where: { cycleId: active.id, employeeId: e.id } });
    if (exists) { console.log(`[ENROLL] ${r.no} sudah ada — skip`); continue; }
    const a = await db.appraisalRecord.create({
      data: {
        docNo: `PER-2026-00${seq}`, cycleId: active.id, employeeId: e.id, managerId: mgr.id,
        status: r.status, selfScore: r.self ?? null, managerScore: r.mgrScore ?? null,
        kpiTotalWeight: 100,
      },
    });
    // 3 KPI pustaka per peserta (pf13)
    for (const s of kpiSpec) {
      const def = kd(s.code);
      await db.appraisalKpi.create({
        data: {
          appraisalId: a.id, kpiDefId: def?.id ?? null,
          title: def?.name ?? "KPI", polarity: def?.polarity ?? "Higher", unit: def?.unit ?? "%",
          thresholdMin: s.thr, target: s.target, stretchValue: s.stretch, weight: s.weight,
          isCritical: false, dataSource: def?.dataSource ?? "Manual",
          origin: def ? "Template" : "Fresh", proposedBy: "Manager",
        },
      });
    }
  }
  // check-in contoh (pf12 kolom)
  const dedi = await db.appraisalRecord.findFirst({ where: { cycleId: active.id, employee: { employeeNo: "MII00009" } } });
  if (dedi && (await db.checkIn.count({ where: { appraisalId: dedi.id } })) === 0) {
    for (const [i, when] of [["2026-05-12", 0], ["2026-08-18", 1]].entries()) {
      await db.checkIn.create({
        data: {
          appraisalId: dedi.id, heldAt: d(when[0] as string),
          agenda: i === 0 ? "Review progress KPI Q1–Q2" : "Pengarahan target H2",
          notesJson: JSON.stringify({ wins: ["Capaian kehadiran di atas target"], blockers: i === 0 ? ["Menunggu data retensi klien"] : [], next: ["Fokus retensi akun kunci"] }),
          managerComment: "Pertahankan ritme; jaga bukti capaian.",
          status: "Held", nextCheckInAt: d("2026-11-10"),
        },
      });
    }
  }
  const appr26 = await db.appraisalRecord.count({ where: { cycleId: active.id } });
  console.log(`[ENROLL] PER-2026 peserta: ${appr26}`);

  console.log("\nSEED P8 SELESAI — data demo laporan kinerja siap.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
