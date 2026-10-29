// OneVity Leave demo-seeder — dipakai prisma/seed.ts (tenant baru) DAN
// scripts/migrate-leave.ts (tenant existing yang di-upgrade modul Leave).
// Data mengikuti ANALISA-LEAVE.md: saldo 2025 (sumber carry) → generate 2026 →
// permintaan + cuti massal SKB + encashment. Idempoten-guarded: bila saldo 2026
// sudah ada, seed dilewati (return skipped).
import { TenantDb } from "./tenant-db";
import { ensureLeaveReference } from "./provisioning";
import { generateLeaveInfo, listBalances, createMassLeave } from "./leave-service";

export async function seedLeaveDemoData(db: TenantDb): Promise<{ skipped: boolean; balances?: number; requests?: number; massGenerated?: number; encashments?: number }> {
  const existing = await db.leaveBalance.count({ where: { year: 2026 } });
  if (existing > 0) return { skipped: true };

  await ensureLeaveReference(db);

  const activeEmployees = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true },
    orderBy: { employeeNo: "asc" },
  });
  // tenant referensi (tanpa karyawan) → hanya master jenis cuti + komponen UCT
  if (activeEmployees.length === 0) return { skipped: true };

  const ltByCode: Record<string, string> = {};
  for (const t of await db.leaveType.findMany({ select: { id: true, code: true } })) ltByCode[t.code] = t.id;

  // -- saldo 2025 (sumber carry-over tahunan): hanya CT-THN, sebagian sudah ambil
  const taken2025 = [0, 3, 5, 2, 4, 6, 1, 3, 0, 2, 5, 3, 0, 4, 2, 1, 6, 3, 0, 2, 4, 1, 3, 0, 5, 2, 1, 4, 0, 3, 2, 1, 5, 0, 2, 4, 1, 3, 0, 2, 1, 4];
  let idx = 0;
  for (const emp of activeEmployees) {
    const taken = taken2025[idx % taken2025.length] ?? 0;
    idx++;
    await db.leaveBalance.create({
      data: { employeeId: emp.id, leaveTypeId: ltByCode["CT-THN"]!, year: 2025, note: "saldo historis 2025" },
    });
    if (taken > 0) {
      await db.leaveRequest.create({
        data: {
          docNo: `LR-2025-${String(idx).padStart(3, "0")}`,
          employeeId: emp.id, leaveTypeId: ltByCode["CT-THN"]!, year: 2025,
          requestDate: new Date(2025, 6, 1),
          dateFrom: new Date(2025, 6, 14), sessionFrom: "AM",
          dateTo: new Date(2025, 6, 13 + taken), sessionTo: "PM",
          workingDays: taken, balanceAtRequest: 12, remainingAtRequest: 12 - taken,
          backToWorkDate: new Date(2025, 6, 14 + taken),
          status: "Approved", source: "Admin",
          reason: "Cuti tahunan reguler 2025", decidedAt: new Date(2025, 6, 2),
        },
      });
    }
  }

  // -- Generate Leave Information 2026 (padanan GenerateLeaveInfoProcess)
  const genRes = await generateLeaveInfo(db, { year: 2026 });

  // -- saldo CT-THN 2026 per karyawan (nilai snapshot permintaan)
  const allBalances = await listBalances(db, { year: 2026, leaveTypeCode: "CT-THN" });
  const thnMap = new Map(allBalances.map((r) => [r.employeeId, r.remaining]));
  const empAt = (i: number) => activeEmployees[i];

  // -- permintaan cuti 2026 (padanan LeaveRequest + LeaveRequestToApprove)
  interface ReqDef { empIdx: number; type: string; from: string; to: string; sf?: "AM" | "PM"; st?: "AM" | "PM"; days: number; status: string; reason: string; decided?: string; decisionNote?: string; reqDate: string }
  const reqDefs: ReqDef[] = [
    { empIdx: 1, type: "CT-THN", from: "2026-08-10", to: "2026-08-12", days: 3, status: "Approved", reason: "Liburan keluarga ke Yogyakarta", reqDate: "2026-07-28", decided: "Disetujui — jadwal produksi aman" },
    { empIdx: 3, type: "CT-THN", from: "2026-08-25", to: "2026-08-25", sf: "PM", st: "PM", days: 0.5, status: "Approved", reason: "Urusan administrasi bank (setengah hari)", reqDate: "2026-08-20", decided: "Setengah hari disetujui" },
    { empIdx: 5, type: "CT-NIKAH", from: "2026-08-17", to: "2026-08-19", days: 3, status: "Approved", reason: "Pernikahan saya sendiri di Solo", reqDate: "2026-08-01", decided: "Disetujui + dokumen undangan diterima" },
    { empIdx: 7, type: "CT-THN", from: "2026-10-05", to: "2026-10-07", days: 3, status: "Approved", reason: "Cuti awal menjelang momen akhir tahun", reqDate: "2026-08-25", decided: "Disetujui — saldo masih cukup" },
    { empIdx: 9, type: "CT-THN", from: "2026-09-15", to: "2026-09-16", days: 2, status: "Submitted", reason: "Menghadiri wisuda adik di Bandung", reqDate: "2026-08-30" },
    { empIdx: 11, type: "CT-THN", from: "2026-09-22", to: "2026-09-22", sf: "PM", st: "PM", days: 0.5, status: "Submitted", reason: "Kontrol kandungan istri (setengah hari)", reqDate: "2026-08-31" },
    { empIdx: 13, type: "CT-MATI-I", from: "2026-09-09", to: "2026-09-10", days: 2, status: "Submitted", reason: "Kematian ayah — dimakamkan di kampung", reqDate: "2026-09-01" },
    { empIdx: 15, type: "CT-THN", from: "2026-08-20", to: "2026-08-21", days: 2, status: "Rejected", reason: "Acara keluarga", reqDate: "2026-08-12", decisionNote: "Bentrok dengan audit internal — usulkan minggu berikutnya" },
    { empIdx: 17, type: "CT-THN", from: "2026-09-03", to: "2026-09-03", days: 1, status: "Cancelled", reason: "Rencana perjalanan dibatalkan", reqDate: "2026-08-18", decided: "Dibatalkan karyawan" },
  ];
  let lrNo = 1;
  for (const r of reqDefs) {
    const emp = empAt(r.empIdx);
    if (!emp) continue;
    const typeId = ltByCode[r.type]!;
    const balance = r.type === "CT-THN" ? (thnMap.get(emp.id) ?? 12) : undefined;
    await db.leaveRequest.create({
      data: {
        docNo: `LR-2026-${String(lrNo++).padStart(3, "0")}`,
        employeeId: emp.id, leaveTypeId: typeId,
        year: new Date(`${r.from}T00:00:00`).getFullYear(),
        requestDate: new Date(`${r.reqDate}T00:00:00`),
        dateFrom: new Date(`${r.from}T00:00:00`), sessionFrom: r.sf ?? "AM",
        dateTo: new Date(`${r.to}T00:00:00`), sessionTo: r.st ?? "PM",
        workingDays: r.days,
        balanceAtRequest: balance ?? 0,
        remainingAtRequest: balance !== undefined ? Math.round((balance - r.days) * 100) / 100 : 0,
        backToWorkDate: null,
        status: r.status, source: "Admin",
        reason: r.reason,
        decidedAt: r.decided ? new Date(2026, 7, 29) : null,
        decisionNote: r.decisionNote ?? r.decided ?? null,
      },
    });
  }

  // -- cuti massal SKB (padanan MassLeave.jsp — cuti bersama 17 Sep 2026)
  let massGenerated = 0;
  try {
    const mlRes = await createMassLeave(db, {
      leaveTypeId: ltByCode["CT-THN"]!,
      letterNo: "SKB-3M-2026-17",
      dateFrom: "2026-09-17", dateTo: "2026-09-17",
      note: "SKB 3 Menteri — cuti bersama 17 September 2026 (ditanggung saldo cuti tahunan)",
      createdBy: "seed",
    });
    massGenerated = mlRes.generated;
  } catch {
    // tanggal 17 Sep mungkin sudah lewat saat migrasi — biarkan request manual
  }

  // -- uang pengganti cuti (padanan LeaveEncashment + Employee LeaveCashable)
  const salaryOf = async (employeeId: string) => {
    const e = await db.employee.findUnique({
      where: { id: employeeId },
      select: { assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 } },
    });
    return e?.assignments[0]?.baseSalary ?? 0;
  };
  const encDefs: { empIdx: number; days: number; status: string; paymentDate?: string; note?: string; periodCode?: string; runNo?: string }[] = [
    { empIdx: 2, days: 4, status: "Approved", paymentDate: "2026-09-25", note: "Pengganti cuti tahunan tidak terpakai" },
    { empIdx: 6, days: 2, status: "Submitted", note: "Butuh dana pendidikan anak" },
    { empIdx: 8, days: 3, status: "Rejected", note: "Permintaan tahun lalu", paymentDate: "2026-08-10" },
    { empIdx: 20, days: 5, status: "Paid", paymentDate: "2026-08-25", note: "Encashment periode Agustus", periodCode: "2026-08", runNo: "PR-2026-08-SAL-01" },
  ];
  let leNo = 1;
  let encCount = 0;
  for (const e of encDefs) {
    const emp = empAt(e.empIdx);
    if (!emp) continue;
    const salary = await salaryOf(emp.id);
    const amount = Math.round((e.days * salary) / 25);
    await db.leaveEncashment.create({
      data: {
        docNo: `LE-2026-${String(leNo++).padStart(3, "0")}`,
        employeeId: emp.id, leaveTypeId: ltByCode["CT-THN"]!, year: 2026,
        requestDate: new Date(2026, 7, 15),
        paymentDate: e.paymentDate ? new Date(`${e.paymentDate}T00:00:00`) : null,
        days: e.days, amount,
        status: e.status, periodCode: e.periodCode ?? null,
        transferredRunNo: e.runNo ?? null,
        decidedAt: e.status !== "Submitted" ? new Date(2026, 7, 18) : null,
        decisionNote: e.status === "Rejected" ? "Tahun ini kuota encashment sudah habis" : e.status !== "Submitted" ? "Disetujui" : null,
        note: e.note ?? null,
      },
    });
    encCount++;
    if (e.status === "Approved" || e.status === "Paid") {
      await db.leaveBalance.update({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: ltByCode["CT-THN"]!, year: 2026 } },
        data: { cashed: e.days },
      });
    }
  }

  return {
    skipped: false,
    balances: genRes.rows,
    requests: reqDefs.length,
    massGenerated,
    encashments: encCount,
  };
}
