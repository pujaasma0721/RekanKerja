// Enrich demo data MII untuk laporan distribusi Travel (T-TRAVEL-REPORTS) =======
// Idempoten (guard: klaim CL-2026-901 sudah ada → skip). Menghidupkan R1.3
// (traveler aktif), R3.1 (pelanggaran limit), R3.2 (lost savings + last-minute),
// R4.1 (akun korporat/CTA), R4.3 (carrier maskapai teridentifikasi):
//   1. TR-2026-011 "Audit klien Surabaya"   — Approved, AKTIF hari ini, advance 4jt Given.
//   2. TR-2026-012 "Kick-off vendor Osaka"  — Approved, berangkat H+20, advance 30jt Requested.
//   3. TR-2026-013 "Negosiasi kontrak distributor" — Approved, aktif, advance 3jt Given.
//   4. TR-2026-014 "Pameran produk Singapura" — Submitted (bukan trip resmi).
//   5. CL-2026-901 hotel Surabaya 2,5jt/malam (di atas plafon SBI 2jt) + dinner 1,9jt
//      (di atas limit 1,5jt) → pelanggaran limit & lost savings.
//   6. CL-2026-902 tiket Garuda GA-316 dibeli H-1 (last-minute) + hotel di bawah plafon.
//   7. CL-2026-903 tiket SQ-955 + hotel Singapura 5jt/malam (di atas SBI 4,8jt) +
//      otherCompanyExp 2,5jt (ditagih akun korporat CTA) + rugi kurs 200rb.
// HANYA INSERT baru — klaim/jurnal existing TIDAK diubah. Semua klaim baru berstatus
// Submitted TANPA jurnal (aman bagi demo payroll).
// Jalankan: bun run scripts/enrich-travel-reports-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

const DAY = 24 * 3600 * 1000;
const dayOffset = (n: number) => {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};

async function main() {
  const db = await getTenantClient(MII_SCHEMA);
  const tc = tenantCryptoForDb(db);

  // ---- guard idempoten ----
  const existing = await db.travelClaim.findUnique({ where: { docNo: "CL-2026-901" }, select: { id: true } });
  if (existing) {
    console.log("ok: data demo laporan travel (CL-2026-901 dst.) sudah ada — tidak ada perubahan");
    await db.$disconnect();
    return;
  }

  // ---- referensi master ----
  const emp = async (no: string) => {
    const e = await db.employee.findUnique({ where: { employeeNo: no }, select: { id: true, fullName: true } });
    if (!e) throw new Error(`Karyawan ${no} tidak ditemukan`);
    return e;
  };
  const tpl = async (code: string) => {
    const t = await db.travelTemplate.findFirst({ where: { code }, select: { id: true, code: true } });
    if (!t) throw new Error(`Template ${code} tidak ditemukan`);
    return t;
  };
  const expType = async (code: string) => {
    const t = await db.travelExpenseType.findUnique({ where: { code }, select: { id: true, code: true, kind: true, limitAmount: true, unlimited: true } });
    if (!t) throw new Error(`Jenis biaya ${code} tidak ditemukan`);
    return t;
  };
  const rate = async (city: string) => {
    const r = await db.travelCityRate.findUnique({ where: { city }, select: { uangHarian: true, plafonHotel: true } });
    if (!r) throw new Error(`Tarif kota ${city} tidak ditemukan`);
    return r;
  };

  const empDewi = await emp("MII00008");      // Manager QA — audit klien
  const empJoko = await emp("MII00005");      // Manager Production — kick-off vendor
  const empBudi = await emp("MII00035");      // Officer Digital Marketing — kontrak distributor
  const empRina = await emp("MII00006");      // Manager Marketing & Sales — pameran produk
  const tTravel = await tpl("TRAVEL");
  const tOverseas = await tpl("TRAVEL-OVERSEAS");
  const tHotel = await expType("L-HOTEL");
  const tResto = await expType("E-RESTAURANT");
  const tTransport = await expType("L-TRANSPORT");
  const tOTransport = await expType("O-TRANSPORT");
  const tOHotel = await expType("O-HOTEL");
  const surabaya = await rate("Surabaya");
  const singapura = await rate("Singapura");
  console.log(`acuan SBI: Surabaya hotel ${surabaya.plafonHotel.toLocaleString("id-ID")}/malam · Singapura hotel ${singapura.plafonHotel.toLocaleString("id-ID")}/malam`);

  // over-limit PER UNIT (mirror travel-service createClaim — Task 98 F0-6/B6).
  const overLimit = (amount: number, qty: number, t: { limitAmount: number; unlimited: boolean }) =>
    !t.unlimited && t.limitAmount > 0 && amount / Math.max(1, qty) > t.limitAmount;

  // ---- 1) request baru ( Approved / Submitted ) ----
  const r11 = await db.travelRequest.create({
    data: {
      docNo: "TR-2026-011", employeeId: empDewi.id,
      requestDate: dayOffset(-8), dateFrom: dayOffset(-4), dateTo: dayOffset(1),
      templateId: tTravel.id, costCenter: "FIN",
      purpose: "Audit klien Surabaya", status: "Approved",
      destinations: { create: { seq: 1, city: "Surabaya", country: "Indonesia", dateFrom: dayOffset(-4), dateTo: dayOffset(1) } },
      advances: { create: { amount: tc.encryptMoney(4_000_000) ?? "0", status: "Given", givenAt: dayOffset(-5), note: "Uang muka audit klien" } },
    },
    include: { destinations: true },
  });
  console.log(`buat: TR-2026-011 Audit klien Surabaya (${empDewi.fullName}) Approved ${r11.dateFrom.toISOString().slice(0, 10)}..${r11.dateTo.toISOString().slice(0, 10)} advance 4jt Given`);

  const r12 = await db.travelRequest.create({
    data: {
      docNo: "TR-2026-012", employeeId: empJoko.id,
      requestDate: dayOffset(-1), dateFrom: dayOffset(20), dateTo: dayOffset(24),
      templateId: tOverseas.id, costCenter: "OP",
      purpose: "Kick-off vendor Osaka", status: "Approved",
      destinations: { create: { seq: 1, city: "Osaka", country: "Jepang", dateFrom: dayOffset(20), dateTo: dayOffset(24), overseas: true } },
      advances: { create: { amount: tc.encryptMoney(30_000_000) ?? "0", status: "Requested", note: "Uang muka menunggu pencairan" } },
    },
  });
  console.log(`buat: TR-2026-012 Kick-off vendor Osaka (${empJoko.fullName}) Approved H+20 advance 30jt Requested`);

  const r13 = await db.travelRequest.create({
    data: {
      docNo: "TR-2026-013", employeeId: empBudi.id,
      requestDate: dayOffset(-5), dateFrom: dayOffset(-2), dateTo: dayOffset(1),
      templateId: tTravel.id, costCenter: "A",
      purpose: "Negosiasi kontrak tahunan distributor", status: "Approved",
      destinations: { create: { seq: 1, city: "Surabaya", country: "Indonesia", dateFrom: dayOffset(-2), dateTo: dayOffset(1) } },
      advances: { create: { amount: tc.encryptMoney(3_000_000) ?? "0", status: "Given", givenAt: dayOffset(-3) } },
    },
  });
  console.log(`buat: TR-2026-013 Negosiasi kontrak distributor (${empBudi.fullName}) Approved aktif advance 3jt Given`);

  const r14 = await db.travelRequest.create({
    data: {
      docNo: "TR-2026-014", employeeId: empRina.id,
      requestDate: dayOffset(-8), dateFrom: dayOffset(-5), dateTo: dayOffset(-1),
      templateId: tOverseas.id, costCenter: "OP",
      purpose: "Pameran produk & meeting distributor", status: "Submitted",
      destinations: { create: { seq: 1, city: "Singapura", country: "Singapura", dateFrom: dayOffset(-5), dateTo: dayOffset(-1), overseas: true } },
    },
  });
  console.log(`buat: TR-2026-014 Pameran produk Singapura (${empRina.fullName}) Submitted (klaim mandiri)`);

  // ---- 2) klaim baru (Submitted, tanpa jurnal) ----
  // (a) CL-2026-901 — hotel di atas plafon SBI + dinner di atas limit → R3.1 & R3.2 hidup.
  {
    const expenses = [
      { t: tHotel, qty: 3, amount: 7_500_000, date: dayOffset(-4), desc: "Hotel Surabaya 3 malam (non-mitra, di atas plafon SBI)" },
      { t: tResto, qty: 1, amount: 1_900_000, date: dayOffset(-2), desc: "Dinner manajemen klien PT Gudang Timur", guest: "Manajemen PT Gudang Timur" },
    ];
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const advance = 4_000_000;
    const R = total; // tanpa (a)/rugi kurs
    await db.travelClaim.create({
      data: {
        docNo: "CL-2026-901", requestId: r11.id, employeeId: empDewi.id,
        claimDate: dayOffset(0), templateId: tTravel.id, costCenter: "FIN",
        purpose: "Audit klien Surabaya", status: "Submitted",
        otherCompanyExp: tc.encryptMoney(0) ?? "0",
        exchangeLoss: tc.encryptMoney(0) ?? "0",
        payableEmployee: tc.encryptMoney(Math.max(0, R - advance)) ?? "0",
        payableCompany: tc.encryptMoney(Math.max(0, advance - R)) ?? "0",
        totalSettlement: tc.encryptMoney(R) ?? "0",
        settlementMethod: "Kas",
        expenses: { create: expenses.map((e) => ({
          expenseCode: e.t.code, kind: e.t.kind, expenseDate: e.date,
          description: e.desc, amount: tc.encryptMoney(e.amount) ?? "0", qty: e.qty,
          guestName: e.guest ?? null, overLimit: overLimit(e.amount, e.qty, e.t),
        })) },
      },
    });
    await db.travelRequest.update({ where: { id: r11.id }, data: { claimRequestedAt: dayOffset(0) } });
    console.log(`buat: CL-2026-901 (Dewi) 2 baris — hotel 2,5jt/malam > SBI ${surabaya.plafonHotel.toLocaleString("id-ID")} (lost 1,5jt) + dinner 1,9jt > limit (b) ${ (R - advance).toLocaleString("id-ID") }`);
  }

  // (b) CL-2026-902 — tiket Garuda dibeli H-1 (last-minute) + hotel di bawah plafon.
  {
    const expenses = [
      { t: tTransport, qty: 1, amount: 3_200_000, date: dayOffset(-3), desc: "Tiket Garuda GA-316 CGK-SUB (beli H-1)" },
      { t: tHotel, qty: 2, amount: 3_600_000, date: dayOffset(-2), desc: "Hotel Surabaya 2 malam (hotel mitra)" },
    ];
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const advance = 3_000_000;
    const R = total;
    await db.travelClaim.create({
      data: {
        docNo: "CL-2026-902", requestId: r13.id, employeeId: empBudi.id,
        claimDate: dayOffset(0), templateId: tTravel.id, costCenter: "A",
        purpose: "Negosiasi kontrak tahunan distributor", status: "Submitted",
        otherCompanyExp: tc.encryptMoney(0) ?? "0",
        exchangeLoss: tc.encryptMoney(0) ?? "0",
        payableEmployee: tc.encryptMoney(Math.max(0, R - advance)) ?? "0",
        payableCompany: tc.encryptMoney(Math.max(0, advance - R)) ?? "0",
        totalSettlement: tc.encryptMoney(R) ?? "0",
        settlementMethod: "Kas",
        expenses: { create: expenses.map((e) => ({
          expenseCode: e.t.code, kind: e.t.kind, expenseDate: e.date,
          description: e.desc, amount: tc.encryptMoney(e.amount) ?? "0", qty: e.qty,
          overLimit: overLimit(e.amount, e.qty, e.t),
        })) },
      },
    });
    await db.travelRequest.update({ where: { id: r13.id }, data: { claimRequestedAt: dayOffset(0) } });
    console.log(`buat: CL-2026-902 (Budi) tiket GA-316 H-1 last-minute 3,2jt + hotel 1,8jt/malam < plafon (b) ${(R - advance).toLocaleString("id-ID")}`);
  }

  // (c) CL-2026-903 — akun korporat CTA + hotel Singapura di atas SBI + rugi kurs → R4.1/R4.3 hidup.
  {
    const expenses = [
      { t: tOTransport, qty: 1, amount: 6_800_000, date: dayOffset(-6), desc: "Tiket Singapore Airlines SQ-955 CGK-SIN (akun korporat)" },
      { t: tOHotel, qty: 3, amount: 15_000_000, date: dayOffset(-5), desc: "Hotel Singapura 3 malam (Marina Bay)" },
    ];
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const a = 2_500_000;   // (a) ditagih langsung ke akun korporat CTA
    const loss = 200_000;  // rugi selisih kurs
    const R = total + loss - a;
    await db.travelClaim.create({
      data: {
        docNo: "CL-2026-903", requestId: r14.id, employeeId: empRina.id,
        claimDate: dayOffset(-1), templateId: tOverseas.id, costCenter: "OP",
        purpose: "Pameran produk & meeting distributor", status: "Submitted",
        otherCompanyExp: tc.encryptMoney(a) ?? "0",
        exchangeLoss: tc.encryptMoney(loss) ?? "0",
        payableEmployee: tc.encryptMoney(R) ?? "0", // tanpa uang muka → b = R
        payableCompany: tc.encryptMoney(0) ?? "0",
        totalSettlement: tc.encryptMoney(R) ?? "0",
        settlementMethod: "Kas",
        expenses: { create: expenses.map((e) => ({
          expenseCode: e.t.code, kind: e.t.kind, expenseDate: e.date,
          description: e.desc, amount: tc.encryptMoney(e.amount) ?? "0", qty: e.qty,
          overLimit: overLimit(e.amount, e.qty, e.t),
        })) },
      },
    });
    console.log(`buat: CL-2026-903 (Rina) SQ-955 6,8jt + hotel 5jt/malam > SBI ${singapura.plafonHotel.toLocaleString("id-ID")} (lost 600rb) + (a) 2,5jt + rugi kurs 200rb → R ${R.toLocaleString("id-ID")}`);
  }

  await db.$disconnect();
  console.log("selesai — enrich demo laporan travel MII (TR-2026-011..014, CL-2026-901..903)");
}

main().catch((e) => { console.error(e); process.exit(1); });
