// Migrasi P6-impl PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P6; §33 alur 9) —
// DEMO data MII (hand-off P5 → P6, kanon E2E §21-5): 2 draf PipPlan dari usulan
// Alur 8 (penilaian Closed rating 2) + SK PIP terbit saat draf (surat 005/006
// HR-PF/X/2026, didahului 4 surat hasil penilaian PERF_RESULT 001-004 utk
// penomoran realistis) + akun ESS demo tuti@mii.co.id. Idempoten per docNo/
// refNo/email. Hanya tenant MII.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { hashPassword } from "@/rekankerja/shared/lib/auth";

const MII = "tenant_pt_mitra_industri_internasional";
const YEAR = new Date().getFullYear();
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const MONTH = ROMAN[new Date().getMonth()];

const TARGETS_TUTI = [
  { title: "Ketepatan penyelesaian tugas", metric: "Tugas selesai tepat waktu", target: "≥ 95%", weight: 40 },
  { title: "Akurasi dokumen kerja", metric: "Error dokumen per bulan", target: "≤ 1 kasus", weight: 30 },
  { title: "Kehadiran & ketepatan waktu", metric: "Persentase kehadiran", target: "≥ 98%", weight: 30 },
];
const TARGETS_ANDI = [
  { title: "Output produksi per shift", metric: "Output vs standar", target: "≥ 95% standar", weight: 40 },
  { title: "Kepatuhan SOP keselamatan", metric: "Audit kepatuhan SOP", target: "100% langkah SOP", weight: 35 },
  { title: "Kerjasama tim", metric: "Penilaian atasan per bulan", target: "≥ 3 dari 5", weight: 25 },
];

export async function main(schemas?: string[]): Promise<void> {
  const list = (schemas && schemas.length > 0 ? schemas : (await platform.tenant.findMany({ select: { schemaName: true } })).map((t) => t.schemaName).filter(Boolean).sort())
    .filter((s) => s.includes("mitra_industri")); // demo hanya MII
  if (list.length === 0) { console.log("[migrate-performance-p6] tidak ada tenant MII — lewati"); return; }
  console.log(`[migrate-performance-p6] schema: ${list.join(", ")}`);
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    const s = list[0];

    // ---- peserta demo: Tuti (karyawan Active, nama depan Tuti) + Andi ----
    const tuti = await c.query(
      `SELECT e.id, e."fullName", e."employeeNo" FROM "${s}"."Employee" e WHERE e."fullName" ILIKE 'Tuti %' AND e.status = 'Active' ORDER BY e."employeeNo" LIMIT 1`,
    );
    const andi = await c.query(
      `SELECT e.id, e."fullName", e."employeeNo" FROM "${s}"."Employee" e WHERE e."fullName" ILIKE 'Andi %' AND e.status = 'Active' ORDER BY e."employeeNo" LIMIT 1`,
    );
    const bambang = await c.query(`SELECT e.id, e."fullName" FROM "${s}"."Employee" e WHERE e."fullName" = 'Bambang Prakoso' LIMIT 1`);
    const dewi = await c.query(`SELECT e.id, e."fullName" FROM "${s}"."Employee" e WHERE e."fullName" = 'Dewi Anggraini' LIMIT 1`);
    if (!tuti.rowCount || !bambang.rowCount) { console.log("  karyawan Tuti/Bambang tidak ditemukan — lewati PIP-0001"); }
    if (!andi.rowCount || !dewi.rowCount) { console.log("  karyawan Andi/Dewi tidak ditemukan — lewati PIP-0002"); }

    // ---- siklus PER-{YEAR-1} (Closed) utk tautan penilaian sumber ----
    const cyc = await c.query(
      `SELECT id FROM "${s}"."PerformanceCycle" WHERE code = $1 LIMIT 1`,
      [`PER-${YEAR - 1}`],
    );
    let cycleId: string | null = cyc.rowCount ? (cyc.rows[0].id as string) : null;
    if (!cycleId) {
      const cur = await c.query(`SELECT id FROM "${s}"."PerformanceCycle" WHERE code = $1 LIMIT 1`, [`PER-${YEAR}`]);
      cycleId = cur.rowCount ? (cur.rows[0].id as string) : null;
    }

    // ---- penilaian Closed rating 2 utk Tuti & Andi (usul PIP Alur 8) ----
    const mkAppraisal = async (docNo: string, employeeId: string, finalScore: number): Promise<string | null> => {
      const already = await c.query(`SELECT id FROM "${s}"."AppraisalRecord" WHERE "docNo" = $1`, [docNo]);
      if (already.rowCount) return already.rows[0].id as string;
      if (!cycleId) return null;
      const r = await c.query(
        `INSERT INTO "${s}"."AppraisalRecord" (id, "docNo", "cycleId", "employeeId", "kpiTotalWeight", "finalScore", "finalRating", status)
         VALUES (gen_random_uuid()::text, $1, $2, $3, 100, $4, 2, 'Closed') RETURNING id`,
        [docNo, cycleId, employeeId, finalScore],
      );
      console.log(`  ${docNo} dibuat (Closed, rating 2 — skor ${finalScore})`);
      return r.rows[0].id as string;
    };
    const apprTuti = tuti.rowCount && cycleId ? await mkAppraisal(`PER-${YEAR - 1}-0011`, tuti.rows[0].id, 64) : null;
    const apprAndi = andi.rowCount && cycleId ? await mkAppraisal(`PER-${YEAR - 1}-0012`, andi.rows[0].id, 62) : null;

    // ---- 4 surat hasil penilaian PERF_RESULT 001-004 (penomoran realistis) ----
    const perfRes = await c.query(
      `SELECT a.id, a."docNo", a."employeeId" FROM "${s}"."AppraisalRecord" a
       WHERE a."docNo" LIKE $1 AND a.status IN ('Published','Closed') ORDER BY a."docNo" LIMIT 4`,
      [`PER-${YEAR - 1}-%`],
    );
    for (let i = 0; i < perfRes.rowCount; i++) {
      const ref = `${String(i + 1).padStart(3, "0")}/HR-PF/${MONTH}/${YEAR}`;
      const exist = await c.query(`SELECT id FROM "${s}"."LetterDocument" WHERE "refNo" = $1`, [ref]);
      if (exist.rowCount) continue;
      const a = perfRes.rows[i];
      await c.query(
        `INSERT INTO "${s}"."LetterDocument" (id, "refNo", "templateKey", category, "employeeId", subject, body, "metaJson", "issuedAt")
         VALUES (gen_random_uuid()::text, $1, 'PERF_RESULT', 'Performance', $2, $3, $4, $5, now())`,
        [ref, a.employeeId, "Surat Hasil Penilaian Kinerja",
          `${ref}\n\nPerihal: Surat Hasil Penilaian Kinerja\n\nKepada Yth. Peserta Penilaian ${a.docNo},\n\nBerdasarkan hasil penilaian kinerja periode berjalan, bersama ini kami sampaikan ringkasan hasil penilaian Anda. Rincian lengkap dapat dilihat pada portal karyawan.\n\nDemikian surat ini kami sampaikan. Hormat kami,\nHR Manager`,
          JSON.stringify({ sourceRef: a.docNo, templateName: "Surat Hasil Penilaian Kinerja", seeded: "performance-p6" })],
      );
    }

    // ---- helper PIP + SK ----
    const mkPip = async (docNo: string, employee: { id: string; fullName: string; employeeNo: string } | null, reviewerId: string | null, appraisalId: string | null, targets: { title: string; metric: string; target: string; weight: number }[], startDate: string, endDate: string, letterRef: string) => {
      if (!employee || !reviewerId) return;
      const already = await c.query(`SELECT id FROM "${s}"."PipPlan" WHERE "docNo" = $1`, [docNo]);
      let pipId: string;
      if (already.rowCount) {
        pipId = already.rows[0].id as string;
      } else {
        const r = await c.query(
          `INSERT INTO "${s}"."PipPlan"
            (id, "docNo", "employeeId", "appraisalId", "startDate", "endDate", "targetsJson", "reviewerId", "hrAdvisorId", status, "outcomeNotes", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, 'Draft', NULL, now(), now())
           RETURNING id`,
          [docNo, employee.id, appraisalId, startDate, endDate, JSON.stringify(targets), reviewerId, null],
        );
        pipId = r.rows[0].id as string;
        // checkpoint 30/60/90 hari (konsisten service createPip)
        for (let i = 0; i < 3; i++) {
          const due = new Date(new Date(startDate).getTime() + [30, 60, 90][i] * 24 * 3600 * 1000);
          await c.query(
            `INSERT INTO "${s}"."PipCheckpoint" (id, "pipId", seq, "dueDate", "achievementPct", notes, status, "reviewedById", "reviewedAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, NULL, NULL, 'Pending', NULL, NULL)`,
            [pipId, i + 1, due],
          );
        }
        await c.query(
          `INSERT INTO "${s}"."ActivityLog" (id, "actorType", action, entity, "entityId", "employeeId", "personnelActionId", detail, "createdAt")
           VALUES (gen_random_uuid()::text, 'system', 'Created', 'PipPlan', $1, $2, NULL, $3, now())`,
          [pipId, employee.id, `Demo P6: draf PIP ${docNo} dibuat utk ${employee.fullName} (${employee.employeeNo}) dari penilaian rating 2 — 3 target Σbobot 100, durasi 2 bln, checkpoint +30/60/90 hari — seed-demo`],
        );
        console.log(`  ${docNo} dibuat (Draft — ${employee.fullName}, pembina terpasang, 3 checkpoint 30/60/90)`);
      }
      // SK PIP terbit saat draf (surat 005/006 — idempoten per refNo + sourceRef)
      const letter = await c.query(`SELECT id FROM "${s}"."LetterDocument" WHERE "refNo" = $1`, [letterRef]);
      if (!letter.rowCount) {
        await c.query(
          `INSERT INTO "${s}"."LetterDocument" (id, "refNo", "templateKey", category, "employeeId", subject, body, "metaJson", "issuedAt")
           VALUES (gen_random_uuid()::text, $1, 'SK_PIP', 'Performance', $2, $3, $4, $5, now())`,
          [letterRef, employee.id, "Surat Keputusan Program Perbaikan Kinerja",
            `${letterRef}\n\nPerihal: Surat Keputusan — Program Perbaikan Kinerja (PIP)\n\nKepada Yth.\nBapak/Ibu ${employee.fullName}\n\nBerdasarkan hasil penilaian kinerja periode berjalan, dengan ini perusahaan menetapkan Saudara/i mengikuti Program Perbaikan Kinerja dengan ketentuan sebagai berikut:\n\n    Dokumen PIP     : ${docNo}\n    Periode program : ${startDate} s.d. ${endDate}\n\nSasaran perbaikan yang harus dicapai selama program berlangsung:\n\n${targets.map((t) => `- ${t.title} — ${t.target} (${t.metric}, bobot ${t.weight}%)`).join("\n")}\n\nSaudara/i wajib mengikuti seluruh tahapan program, termasuk evaluasi berkala (checkpoint) sesuai jadwal yang ditetapkan.\n\nDemikian surat keputusan ini kami sampaikan untuk dilaksanakan sebagaimana mestinya.\n\nHR Manager`,
            JSON.stringify({ sourceRef: docNo, templateName: "SK Program Perbaikan Kinerja", seeded: "performance-p6" })],
        );
        await c.query(
          `INSERT INTO "${s}"."ActivityLog" (id, "actorType", action, entity, "entityId", "employeeId", "personnelActionId", detail, "createdAt")
           VALUES (gen_random_uuid()::text, 'system', 'Processed', 'PipPlan', $1, $2, NULL, $3, now())`,
          [pipId, employee.id, `Demo P6: SK PIP ${docNo} terbit: ${letterRef} (draf — program dimulai setelah persetujuan AS-PIP-STD)`],
        );
        console.log(`  SK PIP ${letterRef} terbit utk ${docNo}`);
      }
    };

    // PIP-2026-0001 — Tuti, pembina Bambang, dari penilaian rating 2
    await mkPip(
      `PIP-${YEAR}-0001`,
      tuti.rowCount ? { id: tuti.rows[0].id, fullName: tuti.rows[0].fullName, employeeNo: tuti.rows[0].employeeNo } : null,
      bambang.rowCount ? bambang.rows[0].id : null,
      apprTuti,
      TARGETS_TUTI,
      `${YEAR}-10-19`, `${YEAR}-12-19`,
      `005/HR-PF/${MONTH}/${YEAR}`,
    );
    // PIP-2026-0002 — Andi, pembina Dewi
    await mkPip(
      `PIP-${YEAR}-0002`,
      andi.rowCount ? { id: andi.rows[0].id, fullName: andi.rows[0].fullName, employeeNo: andi.rows[0].employeeNo } : null,
      dewi.rowCount ? dewi.rows[0].id : null,
      apprAndi,
      TARGETS_ANDI,
      `${YEAR}-10-26`, `${YEAR}-12-25`,
      `006/HR-PF/${MONTH}/${YEAR}`,
    );

    // ---- akun ESS demo tuti@mii.co.id / EssDemo123! (pola seed-ess-demo-user) ----
    if (tuti.rowCount) {
      const emp = tuti.rows[0];
      const appUser = await c.query(`SELECT id FROM "${s}"."AppUser" WHERE email = $1`, ["tuti@mii.co.id"]);
      let appUserId: string;
      if (!appUser.rowCount) {
        // username: nomor karyawan (fallback unik bila dipakai akun lain)
        let username = emp.employeeNo;
        const clash = await c.query(`SELECT id FROM "${s}"."AppUser" WHERE username = $1`, [username]);
        if (clash.rowCount) username = "tuti.ess";
        const r = await c.query(
          `INSERT INTO "${s}"."AppUser" (id, username, "fullName", email, role, "employeeId", active, "passwordChangedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, 'ESS', $4, true, now()) RETURNING id`,
          [username, emp.fullName, "tuti@mii.co.id", emp.id],
        );
        appUserId = r.rows[0].id as string;
        console.log(`  AppUser ESS ${emp.fullName} (${emp.employeeNo}) → tuti@mii.co.id`);
      } else {
        appUserId = appUser.rows[0].id as string;
      }
      const menu = await c.query(`SELECT id FROM "${s}"."UserMenuAccess" WHERE "appUserId" = $1`, [appUserId]);
      if (!menu.rowCount) {
        await c.query(
          `INSERT INTO "${s}"."UserMenuAccess" (id, "appUserId", mode, "menusJson", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, 'CUSTOM', '{}', now())`,
          [appUserId],
        );
      }
      const hist = await c.query(`SELECT id FROM "${s}"."PasswordHistory" WHERE "appUserId" = $1 LIMIT 1`, [appUserId]);
      if (!hist.rowCount) {
        await c.query(
          `INSERT INTO "${s}"."PasswordHistory" (id, "appUserId", hash)
           VALUES (gen_random_uuid()::text, $1, $2)`,
          [appUserId, hashPassword("EssDemo123!")],
        );
      }
      // platform user + membership MII (role HR — AppUser.role ESS mengunci portal)
      let user = await platform.user.findUnique({ where: { email: "tuti@mii.co.id" } });
      if (!user) {
        user = await platform.user.create({ data: { email: "tuti@mii.co.id", name: emp.fullName, passwordHash: hashPassword("EssDemo123!") } });
        console.log("  Platform user tuti@mii.co.id dibuat (EssDemo123!)");
      }
      const tenant = await platform.tenant.findFirst({ where: { slug: "pt-mitra-industri-internasional" } });
      if (tenant) {
        const m = await platform.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } });
        if (!m) {
          await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "HR" } });
          console.log("  Membership MII (HR) dibuat");
        }
      }
    }
  } finally {
    await c.end();
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
