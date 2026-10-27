// UAT-HR-BASE FIX — perbaikan data seed demo MII (temuan UAT 27 Okt 2026) =======
// Idempoten: tiap langkah dicek sebelum menulis. Menangani:
//   A. MIN-07 — EmployeeDocument 0 baris → seed ±16 dokumen dgn expiry bervariasi
//      (sudah lewat / ≤30 / ≤60 / ≤90 / jangka panjang / tanpa expiry) agar
//      fitur monitoring kedaluwarsa 30/60/90 hari dapat diverifikasi.
//   B. MIN-08 — CareerPath 0 baris → seed 7 jalur karier realistis
//      (operator→supervisor→manager, QA, HR, IT, finance) + syarat keahlian.
//   C. MIN-06 — timeline PersonnelAction tidak koheren (submittedAt mendahului
//      createdAt, effectiveDate acak; semua 9 PA terdampak, bukan hanya
//      PA-2026-0002) → redate: created ≤ submitted ≤ effective ≤ processed,
//      + decidedAt layer approval & ActivityLog terkait ikut koheren.
//   D. MIN-05 — 1 karyawan gender "P" (legacy konvensi L/P) → "F".
//   E. Catatan UAT — 5 penugasan aset bertanggal seragam 28 Jun 2026 → disebar.
// Jalankan: bun run scripts/seed-uat-hr-base-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

const DAY = 24 * 3600 * 1000;
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const yearsAgo = (n: number, ref: Date) => new Date(ref.getFullYear() - n, ref.getMonth(), ref.getDate());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const tc = tenantCryptoForDb(db);
  console.log("== UAT-HR-BASE FIX — perbaikan data seed demo MII ==");

  // ---------- A. MIN-07: EmployeeDocument ----------
  {
    const docCount = await db.employeeDocument.count();
    if (docCount > 0) {
      console.log(`[A] EmployeeDocument sudah ada (${docCount}) — skip`);
    } else {
      const emp = async (no: string) => db.employee.findFirst({ where: { employeeNo: no }, select: { id: true, employeeNo: true, fullName: true } });
      interface DocDef { no: string; docType: string; docNumber: string; issuedAt: Date; expiresAt: Date | null; notes: string }
      const sim5y = (exp: Date) => yearsAgo(5, exp);
      const pass10y = (exp: Date) => yearsAgo(10, exp);
      const cert2y = (exp: Date) => yearsAgo(2, exp);
      const defs: DocDef[] = [
        // --- kedaluwarsa (sudah lewat) ---
        { no: "MII00004", docType: "SIM", docNumber: "SIM-A 0112334455", issuedAt: sim5y(daysFromNow(-12)), expiresAt: daysFromNow(-12), notes: "SIM A — kedaluwarsa 12 hari lalu, segera perpanjang" },
        { no: "MII00009", docType: "Sertifikat", docNumber: "K3U-2023-1100", issuedAt: cert2y(daysFromNow(-40)), expiresAt: daysFromNow(-40), notes: "Sertifikat K3 Umum (Kemnaker) — kedaluwarsa, perlu renew" },
        // --- ≤ 30 hari ---
        { no: "MII00009", docType: "Sertifikat", docNumber: "APR-2024-078", issuedAt: cert2y(daysFromNow(8)), expiresAt: daysFromNow(8), notes: "Sertifikat Pengoperasian APAR (Fire Fighting)" },
        { no: "MII00002", docType: "Paspor", docNumber: "XR 981234", issuedAt: pass10y(daysFromNow(25)), expiresAt: daysFromNow(25), notes: "Paspor — berlaku ±3 minggu lagi (perjalanan dinas Q4)" },
        { no: "MII00004", docType: "SIM", docNumber: "SIM-B1 0199887766", issuedAt: sim5y(daysFromNow(18)), expiresAt: daysFromNow(18), notes: "SIM B1 Umum — akan kedaluwarsa bulan ini" },
        // --- ≤ 60 hari ---
        { no: "MII00002", docType: "Paspor", docNumber: "XR 774412", issuedAt: pass10y(daysFromNow(52)), expiresAt: daysFromNow(52), notes: "Paspor — aktif, jadwalkan perpanjangan" },
        { no: "MII00013", docType: "Sertifikat", docNumber: "FL-2025-041", issuedAt: cert2y(daysFromNow(55)), expiresAt: daysFromNow(55), notes: "Lisensi Operator Forklift (BNSP)" },
        // --- ≤ 90 hari ---
        { no: "MII00006", docType: "Paspor", docNumber: "XR 556677", issuedAt: pass10y(daysFromNow(85)), expiresAt: daysFromNow(85), notes: "Paspor — berlaku s.d. awal tahun depan" },
        { no: "MII00013", docType: "Sertifikat", docNumber: "ISO-IA-2023-09", issuedAt: cert2y(daysFromNow(75)), expiresAt: daysFromNow(75), notes: "ISO 14001 Internal Auditor (LSP)" },
        // --- jangka panjang / tanpa expiry ---
        { no: "MII00002", docType: "KTP", docNumber: "3172015502800002", issuedAt: yearsAgo(8, new Date()), expiresAt: null, notes: "KTP elektronik (seumur hidup)" },
        { no: "MII00006", docType: "KTP", docNumber: "3172016408170006", issuedAt: yearsAgo(6, new Date()), expiresAt: null, notes: "KTP elektronik (seumur hidup)" },
        { no: "MII00045", docType: "KK", docNumber: "3172011234560002", issuedAt: yearsAgo(3, new Date()), expiresAt: null, notes: "Kartu Keluarga" },
        { no: "MII00004", docType: "NPWP", docNumber: "09.876.543.2-123.000", issuedAt: yearsAgo(9, new Date()), expiresAt: null, notes: "NPWP pribadi (Kartu Permanen)" },
        { no: "MII00045", docType: "Paspor", docNumber: "XA 102938", issuedAt: pass10y(daysFromNow(3 * 365)), expiresAt: daysFromNow(3 * 365), notes: "Paspor — aktif" },
        { no: "MII00011", docType: "SIM", docNumber: "SIM-C 5566778899", issuedAt: sim5y(daysFromNow(500)), expiresAt: daysFromNow(500), notes: "SIM C" },
        { no: "MII00015", docType: "Sertifikat", docNumber: "CHRP-2022-118", issuedAt: cert2y(daysFromNow(700)), expiresAt: daysFromNow(700), notes: "Certified HR Professional (CHRP)" },
      ];
      let n = 0;
      for (const d of defs) {
        const e = await emp(d.no);
        if (!e) { console.log(`[A] skip ${d.no} (tidak ditemukan)`); continue; }
        await db.employeeDocument.create({
          data: {
            employeeId: e.id, docType: d.docType, docNumber: tc.encryptText(d.docNumber),
            issuedAt: d.issuedAt, expiresAt: d.expiresAt, notes: d.notes,
          },
        });
        n++;
      }
      console.log(`[A] ${n} EmployeeDocument dibuat (expiry: lewat 2 · ≤30 3 · ≤60 2 · ≤90 2 · panjang 7)`);
    }
  }

  // ---------- B. MIN-08: CareerPath ----------
  {
    const pathCount = await db.careerPath.count();
    if (pathCount > 0) {
      console.log(`[B] CareerPath sudah ada (${pathCount}) — skip`);
    } else {
      const [positions, skills] = await Promise.all([
        db.position.findMany({ select: { id: true, code: true, title: true } }),
        db.skillCatalog.findMany({ where: { active: true }, select: { id: true, name: true } }),
      ]);
      const posBy = (code: string) => positions.find((p) => p.code === code);
      const skillBy = (name: string) => skills.find((s) => s.name === name);
      const reqs = (pairs: [string, number][]) =>
        JSON.stringify(pairs.map(([name, level]) => ({ skillId: skillBy(name)?.id ?? "", level })).filter((r) => r.skillId !== ""));
      const paths: { from: string; to: string; skills: [string, number][]; note: string }[] = [
        { from: "P-OPR", to: "P-SUP", skills: [["Kepemimpinan", 3], ["Komunikasi Efektif", 3], ["ISO / Sistem Manajemen Mutu", 2]], note: "Operator senior → supervisor lini: pengalaman 2+ tahun + penguasaan SOP mutu." },
        { from: "P-SUP", to: "P-PRD", skills: [["Perencanaan & Organisasi", 4], ["Kepemimpinan", 4], ["Analisis Data", 3]], note: "Supervisor → manajer produksi: perencanaan kapasitas + pembinaan tim besar." },
        { from: "P-QAS", to: "P-QAM", skills: [["ISO / Sistem Manajemen Mutu", 4], ["Analisis Data", 3], ["Pemecahan Masalah", 4]], note: "QA staff → QA manager: internal auditor + analisis akar masalah (CAPA)." },
        { from: "P-HRS", to: "P-HRM", skills: [["Ketenagakerjaan (UU 13/2003 & turunannya)", 4], ["Coaching & Umpan Balik", 3], ["Komunikasi Efektif", 4]], note: "HR staff → HR manager: penguasaan regulasi ketenagakerjaan + pembinaan staf." },
        { from: "P-HRM", to: "P-HRD", skills: [["Perencanaan & Organisasi", 4], ["Kepemimpinan", 5], ["Negosiasi", 3]], note: "HR manager → direktur HR: strategi SDM + kepemimpinan organisasi lintas fungsi." },
        { from: "P-DEV", to: "P-ITM", skills: [["Sistem ERP", 3], ["SQL / Basis Data", 4], ["Kepemimpinan", 3]], note: "Software engineer → IT manager: arsitektur sistem + kepemimpinan tim teknis." },
        { from: "P-ACC", to: "P-FIN", skills: [["PPh 21 & PPh 26", 4], ["Microsoft Excel", 4], ["Analisis Data", 3]], note: "Accountant → finance manager: pelaporan pajak + analisis keuangan manajerial." },
      ];
      let n = 0;
      for (const p of paths) {
        const from = posBy(p.from);
        const to = posBy(p.to);
        if (!from || !to) { console.log(`[B] skip ${p.from}→${p.to} (posisi tidak ditemukan)`); continue; }
        await db.careerPath.create({
          data: { fromPositionId: from.id, toPositionId: to.id, requiredSkillsJson: reqs(p.skills), note: p.note },
        });
        console.log(`[B] jalur ${from.title} → ${to.title}`);
        n++;
      }
      console.log(`[B] ${n} CareerPath dibuat`);
    }
  }

  // ---------- C. MIN-06: timeline PersonnelAction koheren ----------
  {
    let pas = await db.personnelAction.findMany({
      orderBy: { docNo: "asc" },
      include: { layers: { orderBy: { layerNo: "asc" } } },
    });
    // C1 — level PA: created ≤ submitted ≤ effective ≤ processed (guard: sekali
    // redate acak-koheren; rerun melihat sudah koheren → skip).
    const incoherent = pas.filter((p) =>
      (p.submittedAt && p.submittedAt < p.createdAt) ||
      (p.processedAt && p.processedAt < p.effectiveDate) ||
      p.effectiveDate < (p.submittedAt ?? p.createdAt),
    );
    for (const pa of incoherent) {
      const created = pa.createdAt;
      const submitted = pa.submittedAt && pa.submittedAt >= created ? pa.submittedAt : (pa.submittedAt ? plusDays(created, rand(2, 9)) : null);
      const effective = pa.effectiveDate >= (submitted ?? created) ? pa.effectiveDate : plusDays(submitted ?? created, rand(10, 40));
      const processed = pa.processedAt && pa.processedAt >= effective ? pa.processedAt : (pa.processedAt ? plusDays(effective, rand(2, 10)) : null);
      await db.personnelAction.update({
        where: { id: pa.id },
        data: { submittedAt: submitted, effectiveDate: effective, processedAt: processed },
      });
      console.log(`[C1] ${pa.docNo}: dibuat ${iso(created)} · submit ${submitted ? iso(submitted) : "—"} · efektif ${iso(effective)} · proses ${processed ? iso(processed) : "—"}`);
    }
    if (incoherent.length === 0) console.log("[C1] tanggal level PA sudah koheren — skip");
    // re-fetch setelah C1 — C2/C3 harus melihat tanggal final
    pas = await db.personnelAction.findMany({
      orderBy: { docNo: "asc" },
      include: { layers: { orderBy: { layerNo: "asc" } } },
    });

    // C2 — layer approval: decidedAt harus DI ANTARA submit dan effective
    // (guard deterministik: hanya redate bila di luar rentang — idempoten).
    let nLayer = 0;
    for (const pa of pas) {
      const base = pa.submittedAt ?? pa.createdAt;
      for (const layer of pa.layers) {
        if (layer.status === "Pending" || layer.decidedAt == null) continue;
        const out = layer.decidedAt < base || layer.decidedAt > pa.effectiveDate;
        if (!out) continue;
        const target = plusDays(base, 1 + (layer.layerNo - 1) * 3);
        await db.approvalLayer.update({ where: { id: layer.id }, data: { decidedAt: target } });
        nLayer++;
      }
    }
    console.log(`[C2] ${nLayer} layer approval di-redate ke rentang submit–efektif`);
    // re-fetch setelah C2 — C3 harus melihat decidedAt final layer
    pas = await db.personnelAction.findMany({
      orderBy: { docNo: "asc" },
      include: { layers: { orderBy: { layerNo: "asc" } } },
    });

    // C3 — ActivityLog PA: tanggal log = milestone PA (guard deterministik:
    // selisih > 1 hari dari milestone → redate; rerun stabil).
    let nLog = 0;
    for (const pa of pas) {
      const approved = pa.layers.filter((l) => l.status === "Approved" && l.decidedAt);
      const rejected = pa.layers.find((l) => l.status === "Rejected" && l.decidedAt);
      const lastApproved = approved.length ? approved[approved.length - 1]!.decidedAt! : null;
      const logs = await db.activityLog.findMany({ where: { personnelActionId: pa.id } });
      for (const log of logs) {
        const milestone =
          log.action === "Created" ? pa.createdAt :
          log.action === "Submitted" ? (pa.submittedAt ?? pa.createdAt) :
          log.action === "Processed" ? (pa.processedAt ?? pa.effectiveDate) :
          log.action === "Rejected" ? (rejected?.decidedAt ?? lastApproved ?? pa.submittedAt ?? pa.createdAt) :
          (lastApproved ?? pa.submittedAt ?? pa.createdAt);
        if (Math.abs(log.createdAt.getTime() - milestone.getTime()) > 1 * DAY) {
          await db.activityLog.update({ where: { id: log.id }, data: { createdAt: milestone } });
          nLog++;
        }
      }
    }
    console.log(`[C3] ${nLog} ActivityLog PA di-redate ke milestone dokumen`);

    // C4 — ActivityLog yatim (entityId kosong, detail menyebut docNo) → link + redate
    const orphans = await db.activityLog.findMany({
      where: { entity: "PersonnelAction", personnelActionId: null, detail: { contains: "PA-2026-" } },
    });
    for (const o of orphans) {
      const m = o.detail?.match(/PA-2026-\d{4}/);
      const target = m ? pas.find((p) => p.docNo === m[0]) : null;
      if (!target) continue;
      await db.activityLog.update({
        where: { id: o.id },
        data: { personnelActionId: target.id, entityId: target.id, createdAt: plusDays(target.submittedAt ?? target.createdAt, 4) },
      });
      console.log(`[C4] log yatim "${o.detail?.slice(0, 40)}…" → ter-link ke ${target.docNo}`);
    }
  }

  // ---------- D. MIN-05: normalisasi gender "P" → "F" ----------
  {
    const legacy = await db.employee.findMany({ where: { gender: "P" }, select: { id: true, employeeNo: true, fullName: true } });
    if (legacy.length === 0) {
      console.log("[D] tidak ada gender legacy 'P' — skip");
    } else {
      for (const e of legacy) {
        await db.employee.update({ where: { id: e.id }, data: { gender: "F" } });
        console.log(`[D] ${e.employeeNo} ${e.fullName}: gender "P" → "F"`);
      }
    }
  }

  // ---------- E. Catatan UAT: sebar tanggal penugasan aset ----------
  {
    const SPREAD: Record<string, string> = {
      "AST-0001|MII00006": "2026-02-18",
      "AST-0002|MII00002": "2026-03-15",
      "AST-0003|MII00004": "2026-04-02",
      "AST-0004|MII00009": "2025-11-10",
      "AST-0005|MII00013": "2026-05-20",
    };
    const assignments = await db.assetAssignment.findMany({
      include: { asset: { select: { code: true } }, employee: { select: { employeeNo: true } } },
      orderBy: { assignedAt: "asc" },
    });
    const uniform = assignments.filter((a) => iso(a.assignedAt) === "2026-06-28");
    if (uniform.length === 0) {
      console.log("[E] tanggal penugasan aset sudah tersebar — skip");
    } else {
      let n = 0;
      for (const a of uniform) {
        const key = `${a.asset.code}|${a.employee.employeeNo}`;
        const target = SPREAD[key] ?? (n % 2 === 0 ? "2026-01-25" : "2025-12-08");
        await db.assetAssignment.update({ where: { id: a.id }, data: { assignedAt: new Date(`${target}T09:00:00Z`) } });
        console.log(`[E] ${a.asset.code} → ${a.employee.employeeNo}: ${target}`);
        n++;
      }
      console.log(`[E] ${n} penugasan aset disebar (2025-11 s.d. 2026-05)`);
    }
  }

  console.log("== SELESAI ==");
}

main().catch((e) => { console.error(e); process.exit(1); });
