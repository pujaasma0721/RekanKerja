// RekanKerja Medical demo-seeder — dipakai prisma/seed.ts (tenant baru) DAN
// scripts/migrate-medical.ts (tenant existing yang di-upgrade modul Medical).
// Data mengikuti ANALISA-MEDICAL.md: generate saldo 42 karyawan × 8 jenis,
// klaim bervariasi status (Submitted/Approved/Settled/Rejected), penyesuaian,
// transfer UMC. Idempoten-guarded: bila sudah ada medical claim, seed dilewati.
import { TenantDb } from "./tenant-db";
import { ensureMedicalReference } from "./provisioning";
import {
  generateBalances, submitClaim, decideClaim, submitAdjustment, decideAdjustment,
} from "./medical-service";

interface SeedResult {
  skipped: boolean;
  balances?: number;
  claims?: number;
  adjustments?: number;
}

const ACTOR = "seed-medical";

// definisi klaim: [empIdx, typeCode, tanggal, status target, lines]
interface ClaimDef {
  empIdx: number;
  typeCode: string;
  claimDate: string;
  target: "Submitted" | "Approved" | "Settled" | "Rejected";
  letterNo?: string;
  forDependent?: boolean;
  decisionNote?: string;
  lines: {
    treatedIdx?: number; // -1 = employee sendiri, 0..2 = anggota keluarga
    treatment: string;
    treatmentDate: string;
    receiptNo: string;
    physician: string;
    hospital: string;
    occupationalInjury?: boolean;
    bill: number;
    approved: number;
    note?: string;
  }[];
}

const FAMILY_NAMES = [
  ["Sri Wahyuni", "Raka Pratama", "Nadia Pratama"], // istri + 2 anak
  ["Dewi Lestari", "Bima Saputra"],
  ["Rina Marlina"],
];

const CLAIM_DEFS: ClaimDef[] = [
  // Settled — rawat inap (factor × gaji)
  {
    empIdx: 1, typeCode: "RAWAT_INAP", claimDate: "2026-02-18", target: "Settled",
    letterNo: "RS-0218-114",
    lines: [
      { treatment: "Rawat inap 3 hari — tifus", treatmentDate: "2026-02-15", receiptNo: "INV-2026-0011", physician: "dr. Andini Rahmawati", hospital: "RS Siloam Surabaya", bill: 9_450_000, approved: 8_900_000 },
      { treatment: "Obat & lab kontrol", treatmentDate: "2026-02-18", receiptNo: "INV-2026-0012", physician: "dr. Andini Rahmawati", hospital: "RS Siloam Surabaya", bill: 620_000, approved: 600_000 },
    ],
    decisionNote: "Sesuai surat rujukan & kwitansi",
  },
  // Settled — rawat jalan dependent (anak)
  {
    empIdx: 3, typeCode: "RAWAT_JALAN", claimDate: "2026-03-05", target: "Settled", forDependent: true,
    lines: [
      { treatedIdx: 1, treatment: "Demam berdarah — rawat jalan infus", treatmentDate: "2026-03-03", receiptNo: "INV-2026-0031", physician: "dr. Budi Santoso", hospital: "RS Hertoni Bagyo", bill: 1_850_000, approved: 1_750_000 },
    ],
  },
  // Settled — gigi
  {
    empIdx: 5, typeCode: "GIGI_MULUT", claimDate: "2026-04-22", target: "Settled",
    lines: [
      { treatment: "Scaling + 2 tambal gigi", treatmentDate: "2026-04-20", receiptNo: "INV-2026-0052", physician: "drg. Maya Kusuma", hospital: "Klinik Mitra Sehat", bill: 1_400_000, approved: 1_400_000 },
    ],
  },
  // Settled — kacamata (frekuensi 1×/tahun)
  {
    empIdx: 8, typeCode: "KACAMATA", claimDate: "2026-05-14", target: "Settled",
    lines: [
      { treatment: "Kacamata minus + lensa anti radiasi", treatmentDate: "2026-05-12", receiptNo: "INV-2026-0077", physician: "optometris Andi", hospital: "Apotek Kimia Farma", bill: 1_450_000, approved: 1_400_000 },
    ],
  },
  // Approved — menunggu settle
  {
    empIdx: 10, typeCode: "RAWAT_INAP", claimDate: "2026-08-08", target: "Approved",
    letterNo: "RS-0808-221",
    lines: [
      { treatment: "Operasi apendektomi + rawat 2 hari", treatmentDate: "2026-08-06", receiptNo: "INV-2026-0101", physician: "dr. Hendra Wijaya", hospital: "RS Aditya Husada", bill: 12_800_000, approved: 11_500_000 },
    ],
    decisionNote: "Disetujui — menunggu settle ke kas",
  },
  // Submitted — antrean approval
  {
    empIdx: 12, typeCode: "RAWAT_JALAN", claimDate: "2026-09-01", target: "Submitted",
    lines: [
      { treatment: "Konsultasi spesialis + lab darah", treatmentDate: "2026-08-30", receiptNo: "INV-2026-0113", physician: "dr. Sinta Maharani", hospital: "RS Siloam Surabaya", bill: 980_000, approved: 900_000 },
    ],
  },
  // Submitted — dependent persalinan
  {
    empIdx: 15, typeCode: "PERSALINAN", claimDate: "2026-08-25", target: "Submitted", forDependent: true,
    letterNo: "RS-0825-305",
    lines: [
      { treatedIdx: 0, treatment: "Persalinan normal — istri", treatmentDate: "2026-08-23", receiptNo: "INV-2026-0109", physician: "dr. Ratna Sp.OG", hospital: "RS Aditya Husada", bill: 7_600_000, approved: 7_000_000 },
    ],
  },
  // Submitted — imunisasi anak
  {
    empIdx: 18, typeCode: "IMUNISASI", claimDate: "2026-09-02", target: "Submitted", forDependent: true,
    lines: [
      { treatedIdx: 1, treatment: "Imunisasi MR dosis lanjutan", treatmentDate: "2026-09-01", receiptNo: "INV-2026-0118", physician: "dr. Feri", hospital: "Klinik Mitra Sehat", bill: 350_000, approved: 350_000 },
    ],
  },
  // Rejected — bukti kurang
  {
    empIdx: 20, typeCode: "GIGI_MULUT", claimDate: "2026-06-11", target: "Rejected",
    lines: [
      { treatment: "Pasang behel (estetik)", treatmentDate: "2026-06-09", receiptNo: "INV-2026-0088", physician: "drg. Arya", hospital: "Klinik Mitra Sehat", bill: 8_500_000, approved: 8_500_000 },
    ],
    decisionNote: "Ditolak — behel estetik tidak termasuk cakupan",
  },
  // Submitted — CK (kecelakaan kerja, jenis unlimited)
  {
    empIdx: 22, typeCode: "KHUSUS_PJK", claimDate: "2026-08-29", target: "Submitted",
    lines: [
      { treatment: "Perawatan luka jari — kecelakaan mesin produksi", treatmentDate: "2026-08-28", receiptNo: "INV-2026-0110", physician: "dr. Yuni", hospital: "Klinik Mitra Sehat", occupationalInjury: true, bill: 1_150_000, approved: 1_150_000 },
    ],
  },
];

const ADJ_DEFS: { empIdx: number; typeCode: string; year: number; forDependent: boolean; amount: number; date: string; note: string; target: "Submitted" | "Approved" }[] = [
  { empIdx: 1, typeCode: "RAWAT_JALAN", year: 2026, forDependent: false, amount: 2_000_000, date: "2026-07-02", note: "Tambahan limit perjanjian kollektif — masa kerja > 15 tahun", target: "Approved" },
  { empIdx: 4, typeCode: "GIGI_MULUT", year: 2026, forDependent: false, amount: 1_500_000, date: "2026-08-15", note: "Koreksi limit senior", target: "Approved" },
  { empIdx: 7, typeCode: "RAWAT_JALAN", year: 2026, forDependent: true, amount: 1_000_000, date: "2026-08-30", note: "Anak ke-3 (max umur 21 th)", target: "Submitted" },
  { empIdx: 11, typeCode: "MEDICAL_UMUM", year: 2026, forDependent: false, amount: -500_000, date: "2026-09-01", note: "Pengurangan karena saldo dibayarkan tunai 2025", target: "Submitted" },
];

export async function seedMedicalDemoData(db: TenantDb): Promise<SeedResult> {
  const existing = await db.medicalClaim.count();
  if (existing > 0) return { skipped: true };

  await ensureMedicalReference(db);

  const employees = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, employeeNo: true, fullName: true },
    orderBy: { employeeNo: "asc" },
  });
  if (employees.length === 0) return { skipped: true };
  const empAt = (i: number) => employees[Math.min(i, employees.length - 1)];

  const types = await db.medicalBenefitType.findMany({ select: { id: true, code: true } });
  const typeByCode = new Map(types.map((t) => [t.code, t.id]));

  // 1) generate saldo 2026 semua karyawan × semua jenis
  const gen = await generateBalances(db, { year: 2026 });

  // saldo 2025 (tahun lalu) untuk carry/initial — generate juga supaya
  // demo memiliki basis (hanya utk jenis RAWAT_JALAN supaya cepat)
  await generateBalances(db, { year: 2025, typeId: typeByCode.get("RAWAT_JALAN") });

  // 2) klaim
  let claims = 0;
  for (const def of CLAIM_DEFS) {
    const emp = empAt(def.empIdx);
    const typeId = typeByCode.get(def.typeCode);
    if (!typeId) continue;
    const family = FAMILY_NAMES[def.empIdx % FAMILY_NAMES.length];
    try {
      const res = await submitClaim(db, {
        employeeId: emp.id, typeId, claimDate: def.claimDate,
        letterNo: def.letterNo, forDependent: def.forDependent,
        note: def.decisionNote,
        submit: true,
        lines: def.lines.map((l) => {
          const treated = l.treatedIdx === undefined || l.treatedIdx < 0
            ? emp.fullName
            : family[l.treatedIdx % family.length];
          return {
            treatedName: treated,
            treatment: l.treatment,
            treatmentDate: l.treatmentDate,
            receiptNo: l.receiptNo,
            physician: l.physician,
            hospital: l.hospital,
            occupationalInjury: Boolean(l.occupationalInjury),
            billAmount: l.bill,
            reimburseAmount: l.approved,
            approvedAmount: l.approved,
            note: l.note,
          };
        }),
      }, ACTOR);
      claims++;
      if (def.target === "Approved") {
        await decideClaim(db, { claimId: res.id, action: "approve", note: def.decisionNote }, ACTOR);
      } else if (def.target === "Settled") {
        await decideClaim(db, { claimId: res.id, action: "approve", note: "Disetujui" }, ACTOR);
        await decideClaim(db, { claimId: res.id, action: "settle", note: "Reimbursement dibayarkan via kas" }, ACTOR);
      } else if (def.target === "Rejected") {
        await decideClaim(db, { claimId: res.id, action: "reject", note: def.decisionNote }, ACTOR);
      }
    } catch (e) {
      console.warn(`  [medical-seed] klaim ${def.typeCode}#${def.empIdx} dilewati:`, e instanceof Error ? e.message : e);
    }
  }

  // 3) penyesuaian
  let adjustments = 0;
  for (const def of ADJ_DEFS) {
    const emp = empAt(def.empIdx);
    const typeId = typeByCode.get(def.typeCode);
    if (!typeId) continue;
    try {
      const res = await submitAdjustment(db, {
        employeeId: emp.id, typeId, year: def.year,
        forDependent: def.forDependent, amount: def.amount,
        adjustmentDate: def.date, note: def.note,
      }, ACTOR);
      adjustments++;
      if (def.target === "Approved") {
        await decideAdjustment(db, { adjustmentId: res.id, action: "approve", note: def.note }, ACTOR);
      }
    } catch (e) {
      console.warn(`  [medical-seed] adjustment ${def.typeCode}#${def.empIdx} dilewati:`, e instanceof Error ? e.message : e);
    }
  }

  return { skipped: false, balances: gen.created, claims, adjustments };
}
