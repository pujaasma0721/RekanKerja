// Enrich demo data MII untuk laporan distribusi Medical (T-MED-REPORTS) =======
// Idempoten: tiap langkah mengecek kondisi sebelum menulis. Menambah konfigurasi
// mitra asuransi swasta supaya grup 4 (rekonsiliasi asuransi) & kolom porsi
// asuransi (R3.1/R4.3) menampilkan data bermakna:
//   1. RAWAT_INAP  → 70% perusahaan / 30% asuransi (PT AIA Financial).
//   2. RAWAT_JALAN → 80% perusahaan / 20% asuransi (PT Asuransi AXA Indonesia).
//   3. Snapshot piutang klaim settled jenis tsb (insState/insAmount/insRefNo/
//      insSubmittedAt/insPaidAt) — 1 SUBMITTED (outstanding) + 1 PAID (recovered).
// TIDAK mengubah totalApproved/totalBill/jurnal — snapshot klaim saja, aman
// bagi payroll demo & jurnal yang sudah ada.
// Jalankan: bun scripts/enrich-medical-reports-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

async function main() {
  const db = await getTenantClient(MII_SCHEMA);
  const tc = tenantCryptoForDb(db);

  // ---- 1) konfigurasi mitra asuransi per jenis benefit ----------------------
  const targets: { code: string; pctCompany: number; pctInsurance: number; insurer: string }[] = [
    { code: "RAWAT_INAP", pctCompany: 70, pctInsurance: 30, insurer: "PT AIA Financial" },
    { code: "RAWAT_JALAN", pctCompany: 80, pctInsurance: 20, insurer: "PT Asuransi AXA Indonesia" },
  ];
  for (const t of targets) {
    const ty = await db.medicalBenefitType.findFirst({ where: { code: t.code }, select: { id: true, pctCompany: true, pctInsurance: true } });
    if (!ty) { console.log(`skip: jenis ${t.code} tidak ditemukan`); continue; }
    if (ty.pctInsurance === t.pctInsurance) { console.log(`ok: ${t.code} sudah ${t.pctInsurance}% asuransi`); continue; }
    await db.medicalBenefitType.update({
      where: { id: ty.id },
      data: { pctCompany: t.pctCompany, pctInsurance: t.pctInsurance, insuranceCompany: t.insurer },
    });
    console.log(`set: ${t.code} → perusahaan ${t.pctCompany}% / asuransi ${t.pctInsurance}% (${t.insurer})`);
  }

  // ---- 2) snapshot piutang asuransi klaim settled jenis tsb ----------------
  // MC-2026-001 RAWAT_INAP  approved 9.500.000 → asuransi 30% = 2.850.000 (SUBMITTED, outstanding)
  // MC-2026-002 RAWAT_JALAN approved 1.750.000 → asuransi 20% =   350.000 (PAID, recovered)
  const plans: {
    docNo: string; insState: string; refNo: string; submittedAt: string;
    paidAt?: string; paidAmount?: number;
  }[] = [
    { docNo: "MC-2026-001", insState: "SUBMITTED", refNo: "AIA-CLM-2026-88123", submittedAt: "2026-03-02" },
    { docNo: "MC-2026-002", insState: "PAID", refNo: "AXA-CLM-2026-45210", submittedAt: "2026-03-10", paidAt: "2026-04-05", paidAmount: 350_000 },
  ];
  for (const p of plans) {
    const c = await db.medicalClaim.findUnique({
      where: { docNo: p.docNo },
      select: { id: true, insState: true, insAmount: true, totalApproved: true, type: { select: { code: true, pctInsurance: true } } },
    });
    if (!c) { console.log(`skip: klaim ${p.docNo} tidak ditemukan`); continue; }
    if (c.insState !== "NONE" && (tc.decryptMoney(c.insAmount) ?? 0) > 0) {
      console.log(`ok: ${p.docNo} sudah ${c.insState}`); continue; }
    const part = Math.round(((tc.decryptMoney(c.totalApproved) ?? 0) * (c.type.pctInsurance / 100)) / 50) * 50;
    await db.medicalClaim.update({
      where: { id: c.id },
      data: {
        insState: p.insState,
        insRefNo: p.refNo,
        insAmount: tc.encryptMoney(part) ?? "0",
        insSubmittedAt: new Date(`${p.submittedAt}T09:00:00Z`),
        ...(p.paidAt ? {
          insPaidAt: new Date(`${p.paidAt}T09:00:00Z`),
          insPaidAmount: tc.encryptMoney(p.paidAmount ?? part) ?? "0",
        } : {}),
      },
    });
    console.log(`set: ${p.docNo} (${c.type.code}) → ${p.insState} Rp ${part.toLocaleString("id-ID")} ref ${p.refNo}`);
  }

  await db.$disconnect();
  console.log("selesai — enrich demo asuransi medical MII");
}

main().catch((e) => { console.error(e); process.exit(1); });
