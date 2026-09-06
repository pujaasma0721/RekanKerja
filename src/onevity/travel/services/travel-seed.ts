// OneVity Travel demo-seeder — dipakai prisma/seed.ts (tenant baru) DAN
// scripts/migrate-travel.ts (tenant existing yang di-upgrade modul Travel).
// Data mengikuti ANALISA-TRAVEL.md: budget 2026 per cost center, permintaan
// multi-destinasi + uang muka, klaim settlement (formula a/b/c), jurnal otomatis,
// status akhir Transferred/Paid. Idempoten-guarded: bila sudah ada travel request,
// seed dilewati (return skipped).
import { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { ensureTravelReference } from "@/onevity/shared/lib/provisioning";
import { decideClaim } from "./travel-service";

interface SeedResult {
  skipped: boolean;
  requests?: number;
  claims?: number;
  budgetYear?: number;
}

export async function seedTravelDemoData(db: TenantDb): Promise<SeedResult> {
  const existing = await db.travelRequest.count();
  if (existing > 0) return { skipped: true };

  await ensureTravelReference(db);

  const activeEmployees = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, employeeNo: true },
    orderBy: { employeeNo: "asc" },
  });
  // tenant referensi (tanpa karyawan) → hanya master travel + komponen UTRP/TRVSTLIN
  if (activeEmployees.length === 0) return { skipped: true };
  const empAt = (i: number) => activeEmployees[Math.min(i, activeEmployees.length - 1)];

  const tpl = await db.travelTemplate.findMany({ select: { id: true, code: true } });
  const tplByCode = new Map(tpl.map((t) => [t.code, t.id]));

  // ---- budget 2026 (padanan TravelPeriod + Budget Per Cost Center MII)
  await db.travelBudget.create({
    data: {
      year: 2026, startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31),
      totalBudget: 250_000_000, note: "Budget travel MII 2026 — dibagi per cost center",
      items: {
        create: [
          { costCenter: "OP", amount: 100_000_000, note: "Operasional" },
          { costCenter: "A", amount: 80_000_000, note: "Produksi" },
          { costCenter: "FIN", amount: 40_000_000, note: "Finance & audit" },
          { costCenter: "HRD", amount: 30_000_000, note: "Rekrutmen & pelatihan" },
        ],
      },
    },
  });

  // ---- travel request (padanan TravelRequest.jsp — destinasi multi-kaki + advance)
  interface ReqDef {
    empIdx: number; template: string; from: string; to: string; purpose: string;
    status: string; costCenter?: string; remark?: string;
    destinations: { from: string; to: string; city: string; country?: string; zone?: string; overseas?: boolean }[];
    advance?: number; advanceNote?: string; decisionNote?: string;
  }
  const reqDefs: ReqDef[] = [
    {
      empIdx: 2, template: "TRAVEL-OVERSEAS", from: "2026-09-14", to: "2026-09-18",
      purpose: "Negosiasi kontrak pemasok komponen", status: "Approved", costCenter: "OP",
      remark: "Meeting dengan 2 vendor — jadwal sudah dikonfirmasi via email",
      destinations: [
        { from: "2026-09-14", to: "2026-09-16", city: "Singapura", country: "Singapura", zone: "ASIA", overseas: true },
        { from: "2026-09-16", to: "2026-09-18", city: "Kuala Lumpur", country: "Malaysia", zone: "ASIA", overseas: true },
      ],
      advance: 15_000_000, advanceNote: "Uang muka transport & hotel (TRVLOAN)",
      decisionNote: "Disetujui — mantapkan cuti harga sebelum Q4",
    },
    {
      empIdx: 4, template: "TRAVEL", from: "2026-09-07", to: "2026-09-09",
      purpose: "Audit mutu pabrik mitra Bandung", status: "Approved", costCenter: "FIN",
      destinations: [
        { from: "2026-09-07", to: "2026-09-09", city: "Bandung", zone: "JABAR" },
      ],
      advance: 3_000_000, advanceNote: "Uang muka hotel & transport",
      decisionNote: "Disetujui — sertakan temuan audit terakhir",
    },
    {
      empIdx: 6, template: "TRAVEL-LOCAL-150", from: "2026-09-22", to: "2026-09-23",
      purpose: "Pengecekan gudang regional Karawang", status: "Submitted", costCenter: "A",
      destinations: [
        { from: "2026-09-22", to: "2026-09-23", city: "Karawang", zone: "LOCAL" },
      ],
    },
    {
      empIdx: 8, template: "TRAVEL", from: "2026-09-28", to: "2026-10-02",
      purpose: "Pendampingan instalasi mesin Surabaya", status: "Submitted", costCenter: "A",
      destinations: [
        { from: "2026-09-28", to: "2026-09-30", city: "Semarang" },
        { from: "2026-09-30", to: "2026-10-02", city: "Surabaya" },
      ],
      advance: 5_000_000,
    },
    {
      empIdx: 10, template: "TRAVEL-OVERSEAS", from: "2026-10-05", to: "2026-10-10",
      purpose: "Pameran teknologi manufaktur (Jepang)", status: "Approved", costCenter: "OP",
      destinations: [
        { from: "2026-10-05", to: "2026-10-10", city: "Osaka", country: "Jepang", zone: "OTHERS", overseas: true },
      ],
      advance: 25_000_000, advanceNote: "Uang muka penuh (kurs tinggi)",
      decisionNote: "Disetujui — laporan wajib within 14 hari",
    },
    {
      empIdx: 12, template: "TRAVEL-KA", from: "2026-09-15", to: "2026-09-16",
      purpose: "Rapat koordinasi distributor Semarang", status: "Rejected", costCenter: "OP",
      destinations: [
        { from: "2026-09-15", to: "2026-09-16", city: "Semarang" },
      ],
      decisionNote: "Ditolak — wakili via video conference tahun ini",
    },
  ];

  const zoneByCode = new Map((await db.travelZone.findMany()).map((z) => [z.code, z.id]));
  let trNo = 1;
  const createdRequests: Record<number, string> = {};
  for (const r of reqDefs) {
    const emp = empAt(r.empIdx);
    if (!emp) continue;
    const docNo = `TR-2026-${String(trNo++).padStart(3, "0")}`;
    createdRequests[r.empIdx] = docNo;
    await db.travelRequest.create({
      data: {
        docNo, employeeId: emp.id,
        requestDate: new Date(`${r.from}T00:00:00`),
        dateFrom: new Date(`${r.from}T00:00:00`),
        dateTo: new Date(`${r.to}T00:00:00`),
        templateId: tplByCode.get(r.template)!,
        costCenter: r.costCenter ?? null,
        purpose: r.purpose, remark: r.remark ?? null,
        status: r.status,
        decidedAt: r.status === "Submitted" ? null : new Date(2026, 8, 1),
        decisionNote: r.decisionNote ?? null,
        destinations: {
          create: r.destinations.map((d, i) => ({
            seq: i + 1,
            dateFrom: new Date(`${d.from}T00:00:00`),
            dateTo: new Date(`${d.to}T00:00:00`),
            city: d.city, country: d.country ?? "Indonesia",
            zoneId: d.zone ? zoneByCode.get(d.zone) ?? null : null,
            overseas: d.overseas ?? false,
          })),
        },
        ...(r.advance ? {
          advances: {
            create: {
              amount: r.advance, note: r.advanceNote ?? null,
              // M-3/B5 (T3-TRAVEL): lifecycle — hanya request Approved yang uang
              // mukanya "Given" (givenAt terisi); Submitted = Requested (belum cair).
              status: r.status === "Approved" ? "Given" : "Requested",
              givenAt: r.status === "Approved" ? new Date(2026, 8, 1) : null,
            },
          },
        } : {}),
      },
    });
  }

  // ---- klaim / settlement (padanan TravelClaim.jsp — formula T3-TRAVEL:
  //   totalSettlement = Σ rincian + rugi kurs − (a); b/c = max(0, R − advance)/max(0, advance − R))
  interface ExpDef { code: string; date?: string; desc?: string; amount: number; qty?: number; guest?: string }
  interface ClaimDef {
    empIdx: number; requestIdEmpIdx?: number; template: string; claimDate: string;
    purpose?: string; costCenter?: string; voucher?: string;
    expenses: ExpDef[];
    otherCompanyExp?: number; exchangeLoss?: number; payableEmployee: number; payableCompany: number;
    targetStatus: "Submitted" | "Approved" | "Transferred" | "Paid";
    periodCode?: string; runNo?: string; remark?: string;
  }
  const claimDefs: ClaimDef[] = [
    // klaim dinas Bandung dari TR-2026-002 — advance 3jt, realisasi lebih besar → b
    {
      empIdx: 4, requestIdEmpIdx: 4, template: "TRAVEL", claimDate: "2026-09-12",
      purpose: "Audit mutu pabrik mitra Bandung", costCenter: "FIN", voucher: "V-2609-001",
      expenses: [
        { code: "L-TRANSPORT", date: "2026-09-07", desc: "KA Argo Parahyangan PP + taksi", amount: 850_000, qty: 1 },
        { code: "L-HOTEL", date: "2026-09-07", desc: "Hotel 2 malam (hotel mitra)", amount: 1_400_000, qty: 2 },
        { code: "L-MEALS", date: "2026-09-08", desc: "Makan selama penugasan", amount: 450_000, qty: 3 },
        { code: "L-POCKET", date: "2026-09-07", desc: "Uang saku 3 hari", amount: 1_200_000, qty: 3 },
      ],
      payableEmployee: 900_000, payableCompany: 0,
      targetStatus: "Approved", remark: "Kwitansi hotel & tiket terlampir",
    },
    // klaim dinas luar negeri TR-2026-001 — advance 15jt, realisasi < advance → c
    {
      empIdx: 2, requestIdEmpIdx: 2, template: "TRAVEL-OVERSEAS", claimDate: "2026-09-21",
      purpose: "Negosiasi kontrak pemasok komponen", costCenter: "OP", voucher: "V-2609-002",
      expenses: [
        { code: "O-TRANSPORT", date: "2026-09-14", desc: "Tiket CGK-SIN-KUL-CGK", amount: 4_500_000, qty: 1 },
        { code: "O-HOTEL", date: "2026-09-14", desc: "Hotel 4 malam (SG+KL)", amount: 6_000_000, qty: 4 },
        { code: "O-MEALS", date: "2026-09-15", desc: "Makan & transport lokal 5 hari", amount: 2_400_000, qty: 5 },
        { code: "O-LICENSE", date: "2026-09-10", desc: "Visa & travel document", amount: 800_000, qty: 1 },
      ],
      exchangeLoss: 300_000,
      payableEmployee: 0, payableCompany: 1_000_000,
      targetStatus: "Submitted", remark: "Kelebihan uang muka akan dikembalikan via potongan payroll",
    },
    // klaim entertainment mandiri (tanpa request — padanan claim bebas)
    {
      empIdx: 14, template: "TRAVEL", claimDate: "2026-09-24",
      purpose: "Entertainment pelanggan prioritas (dinner + hadiah)", costCenter: "OP",
      expenses: [
        { code: "E-RESTAURANT", date: "2026-09-20", desc: "Dinner pelanggan PT Sinar Abadi (4 orang)", amount: 1_450_000, qty: 1, guest: "Direktur PT Sinar Abadi + 3" },
        { code: "E-GIFT", date: "2026-09-20", desc: "Souvenir perusahaan", amount: 750_000, qty: 1, guest: "Manajer Purchasing" },
      ],
      payableEmployee: 2_200_000, payableCompany: 0,
      targetStatus: "Submitted",
    },
    // klaim mileage kecil — sudah Transferred ke period Sep
    {
      empIdx: 16, template: "TRAVEL-LOCAL-150", claimDate: "2026-08-28",
      purpose: "Kunjungan pelanggan Kab. Bekasi (kendaraan pribadi)", costCenter: "A",
      expenses: [
        { code: "L-BBM", date: "2026-08-26", desc: "BBM 2 hari kunjungan", amount: 250_000, qty: 2 },
        { code: "L-JARAK", date: "2026-08-26", desc: "Jarak tempuh 120 km × Rp2.500", amount: 300_000, qty: 120 },
        { code: "L-MEALS", date: "2026-08-26", desc: "Makan perjalanan", amount: 180_000, qty: 2 },
      ],
      payableEmployee: 730_000, payableCompany: 0,
      targetStatus: "Transferred", periodCode: "2026-08",
    },
    // klaim lokal — sudah Paid (period Agu, run konfirmasi)
    {
      empIdx: 18, template: "TRAVEL-LOCAL-150", claimDate: "2026-08-14",
      purpose: "Pengambilan sampel bahan baku Karawang", costCenter: "A",
      expenses: [
        { code: "L-TRANSPORT", date: "2026-08-12", desc: "Rental mobil 1 hari", amount: 600_000, qty: 1 },
        { code: "L-MEALS", date: "2026-08-12", desc: "Makan tim (2 orang)", amount: 250_000, qty: 1 },
      ],
      payableEmployee: 850_000, payableCompany: 0,
      targetStatus: "Paid", periodCode: "2026-08", runNo: "PR-2026-08-SAL-01",
    },
  ];

  let clNo = 1;
  let claimCount = 0;
  for (const c of claimDefs) {
    const emp = empAt(c.empIdx);
    if (!emp) continue;
    const docNo = `CL-2026-${String(clNo++).padStart(3, "0")}`;
    const a = c.otherCompanyExp ?? 0;
    const loss = c.exchangeLoss ?? 0;
    // T3-TRAVEL: totalSettlement = gross settlement (R) — konsisten dgn jurnal & migrasi.
    const expSum = c.expenses.reduce((s, e) => s + e.amount, 0);
    const total = Math.round((expSum + loss - a) * 100) / 100;
    const reqDocNo = c.requestIdEmpIdx ? createdRequests[c.requestIdEmpIdx] : null;
    const reqRow = reqDocNo ? await db.travelRequest.findUnique({ where: { docNo: reqDocNo } }) : null;

    const claim = await db.travelClaim.create({
      data: {
        docNo,
        requestId: reqRow?.id ?? null,
        employeeId: emp.id,
        claimDate: new Date(`${c.claimDate}T00:00:00`),
        templateId: tplByCode.get(c.template)!,
        costCenter: c.costCenter ?? reqRow?.costCenter ?? null,
        purpose: c.purpose ?? reqRow?.purpose ?? null,
        remark: c.remark ?? null,
        status: "Submitted",
        otherCompanyExp: a, exchangeLoss: loss,
        payableEmployee: c.payableEmployee, payableCompany: c.payableCompany,
        totalSettlement: total,
        settlementMethod: "Kas",
        voucherNo: c.voucher ?? null,
        expenses: {
          create: c.expenses.map((e) => ({
            expenseCode: e.code,
            expenseDate: e.date ? new Date(`${e.date}T00:00:00`) : null,
            description: e.desc ?? null,
            amount: e.amount, qty: e.qty ?? 1,
            guestName: e.guest ?? null,
          })),
        },
      },
    });
    if (reqRow && !reqRow.claimRequestedAt) {
      await db.travelRequest.update({ where: { id: reqRow.id }, data: { claimRequestedAt: new Date() } });
    }

    if (c.targetStatus === "Approved" || c.targetStatus === "Transferred" || c.targetStatus === "Paid") {
      // approve via service → jurnal otomatis (padanan Journal No/Type/Date)
      await decideClaim(db, { id: claim.id, action: "approve", note: "Disetujui — dokumen lengkap" });
      if (c.targetStatus === "Transferred") {
        await db.travelClaim.update({
          where: { id: claim.id },
          data: { status: "Transferred", periodCode: c.periodCode ?? "2026-08" },
        });
      } else if (c.targetStatus === "Paid") {
        await db.travelClaim.update({
          where: { id: claim.id },
          data: {
            status: "Paid", periodCode: c.periodCode ?? "2026-08",
            transferredRunNo: c.runNo ?? "PR-2026-08-SAL-01",
            paidRunNo: c.runNo ?? "PR-2026-08-SAL-01",
          },
        });
      }
    }
    claimCount++;
  }

  return { skipped: false, requests: reqDefs.length, claims: claimCount, budgetYear: 2026 };
}
