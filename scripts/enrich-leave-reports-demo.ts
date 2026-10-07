// Enrich demo data MII untuk tab "Reports" modul Leave (T112) =================
// Idempoten: tiap langkah mengecek kondisi sebelum menulis. Menambah:
//   1. Jenis cuti CT-SAKIT (Cuti Sakit + SKD — UU 13/2003 Ps.93) bila belum ada.
//   2. Permintaan cuti sakit (5 Approved + 1 Submitted; 4 lengkap SKD di catatan,
//      2 tanpa SKD → temuan audit R3.2).
//   3. Cuti khusus regulasi (R4.1): melahirkan 3 bln, keguguran 1,5 bln,
//      khitanan, kelahiran anak (suami), kematian serumah.
//   4. Cuti Besar / long-service (R4.2): karyawan tenure ≥ 6 thn.
//   5. Cuti haid (R4.3): 3 karyawan perempuan (1 setengah hari).
//   6. Cuti tahunan terjadwal Nov–Des 2026 (R2.3 jadwal departemen) + 1 pending
//      tambahan (R2.2 pipeline).
// Jalankan: bun scripts/enrich-leave-reports-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

/** Hari kerja Sen–Jumat antar dua tanggal (inklusif). */
function workdays(from: Date, to: Date): number {
  let n = 0;
  const d = new Date(from);
  while (d <= to) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

const D = (s: string) => new Date(`${s}T00:00:00`);

interface SeedReq {
  docNo: string;
  emp: string;
  type: string;
  from: string;
  to: string;
  sf?: "AM" | "PM";
  st?: "AM" | "PM";
  status: string;
  reason: string;
  note?: string;
  source?: string;
}

const SEED: SeedReq[] = [
  // ---- Cuti sakit (R3.2) — 2 tanpa SKD → temuan ----
  { docNo: "LR-2026-201", emp: "MII00016", type: "CT-SAKIT", from: "2026-09-14", to: "2026-09-16", status: "Approved", reason: "Demam berdarah — rawat jalan RS", note: "SKD No. RS-2026-0431 (RS Harapan) — 3 hari istirahat", source: "ESS" },
  { docNo: "LR-2026-202", emp: "MII00020", type: "CT-SAKIT", from: "2026-09-22", to: "2026-09-22", status: "Approved", reason: "Flu dan demam", note: "SKD No. KLINIK-2026-112 (Klinik Sehat Sentosa)", source: "ESS" },
  { docNo: "LR-2026-203", emp: "MII00007", type: "CT-SAKIT", from: "2026-10-01", to: "2026-10-02", status: "Approved", reason: "Sakit gigi — kontrol dokter gigi", source: "ESS" },
  { docNo: "LR-2026-204", emp: "MII00018", type: "CT-SAKIT", from: "2026-09-08", to: "2026-09-09", status: "Approved", reason: "Maag akut", note: "SKD No. KLINIK-2026-098 (Klinik Sehat Sentosa)", source: "ESS" },
  { docNo: "LR-2026-205", emp: "MII00010", type: "CT-SAKIT", from: "2026-09-29", to: "2026-09-30", status: "Approved", reason: "Tifus — istirahat total", source: "Admin" },
  { docNo: "LR-2026-206", emp: "MII00026", type: "CT-SAKIT", from: "2026-10-06", to: "2026-10-06", status: "Submitted", reason: "Kontrol pasca operasi kecil", note: "SKD No. RS-2026-0517 (RS Harapan) — kontrol 1 hari", source: "ESS" },
  // ---- Cuti khusus regulasi (R4.1) ----
  { docNo: "LR-2026-207", emp: "MII00019", type: "CT-LAHIR-P", from: "2026-08-01", to: "2026-10-31", status: "Approved", reason: "Cuti melahirkan — persalinan anak kedua", note: "SKD dokter kandungan: persalinan normal 30 Jul 2026; perpanjangan tidak diperlukan", source: "Admin" },
  { docNo: "LR-2026-208", emp: "MII00028", type: "CT-GUGUR-P", from: "2026-09-01", to: "2026-09-21", status: "Approved", reason: "Cuti keguguran — sesuai anjuran dokter kandungan", note: "SKD dokter kandungan: keguguran 31 Agu 2026, istirahat 1,5 bulan", source: "Admin" },
  { docNo: "LR-2026-209", emp: "MII00012", type: "CT-KHITAN", from: "2026-09-17", to: "2026-09-18", status: "Approved", reason: "Khitanan anak pertama", note: "Surat keterangan rumah sakit terlampir", source: "ESS" },
  { docNo: "LR-2026-210", emp: "MII00009", type: "CT-LAHIR", from: "2026-09-03", to: "2026-09-04", status: "Approved", reason: "Istri melahirkan anak ketiga", note: "Surat kelahiran RS terlampir", source: "ESS" },
  { docNo: "LR-2026-211", emp: "MII00022", type: "CT-MATI-S", from: "2026-09-11", to: "2026-09-11", status: "Approved", reason: "Kematian nenek (satu rumah)", source: "ESS" },
  // ---- Cuti Besar / long-service (R4.2) ----
  { docNo: "LR-2026-212", emp: "MII00021", type: "CT-BESAR", from: "2026-10-12", to: "2026-10-27", status: "Approved", reason: "Cuti Besar masa kerja 10 tahun — ibadah & kunjungan keluarga", note: "Disetujui Direksi — handover ke Wakil Kepala Shift", source: "Admin" },
  // ---- Cuti haid (R4.3) ----
  { docNo: "LR-2026-213", emp: "MII00006", type: "CT-HAID", from: "2026-09-24", to: "2026-09-24", status: "Approved", reason: "Cuti haid hari pertama", source: "ESS" },
  { docNo: "LR-2026-214", emp: "MII00015", type: "CT-HAID", from: "2026-10-08", to: "2026-10-08", status: "Submitted", reason: "Cuti haid hari pertama", source: "ESS" },
  { docNo: "LR-2026-215", emp: "MII00013", type: "CT-HAID", from: "2026-09-07", to: "2026-09-07", sf: "PM", st: "PM", status: "Approved", reason: "Cuti haid (setengah hari, sesi sore)", source: "ESS" },
  // ---- Jadwal cuti mendatang (R2.3) ----
  { docNo: "LR-2026-216", emp: "MII00005", type: "CT-THN", from: "2026-11-16", to: "2026-11-20", status: "Approved", reason: "Liburan keluarga — akhir tahun sekolah", source: "ESS" },
  { docNo: "LR-2026-217", emp: "MII00017", type: "CT-THN", from: "2026-11-23", to: "2026-11-25", status: "Approved", reason: "Mengurus renovasi rumah", source: "ESS" },
  { docNo: "LR-2026-218", emp: "MII00038", type: "CT-THN", from: "2026-12-07", to: "2026-12-09", status: "Approved", reason: "Istirahat akhir tahun", source: "Admin" },
  { docNo: "LR-2026-219", emp: "MII00039", type: "CT-THN", from: "2026-12-14", to: "2026-12-18", status: "Submitted", reason: "Tiket pulang kampung sudah dipesan", source: "ESS" },
];

async function main() {
  const db = getTenantClient(MII_SCHEMA);

  const company = await db.company.findFirst({ select: { id: true } });
  if (!company) throw new Error("Company MII tidak ditemukan — jalankan restore-demo dulu");

  // ---------- 1. Jenis cuti CT-SAKIT ----------
  const sakit = await db.leaveType.upsert({
    where: { code: "CT-SAKIT" },
    create: {
      code: "CT-SAKIT",
      name: "Cuti Sakit (dengan SKD)",
      description: "Izin sakit dibayar penuh dengan Surat Keterangan Dokter (UU 13/2003 pasal 93)",
      unit: "DAY",
      entitlement: 12,
      maxPerRequest: 0,
      paid: true,
      cashable: false,
      periodMode: "CALENDAR",
      prorateMonthly: false,
      carryOverMax: 0,
      waitingMonths: 0,
      allowAdvance: true,
      allowHalfDay: true,
      needDocs: true,
      active: true,
    },
    update: {},
  });
  console.log(`[1] Jenis cuti CT-SAKIT siap (${sakit.id})`);

  // ---------- 2. Permintaan cuti ----------
  const types = await db.leaveType.findMany({ select: { id: true, code: true, unit: true, entitlement: true } });
  const tBy = new Map(types.map((t) => [t.code, t]));
  const emps = await db.employee.findMany({ select: { id: true, employeeNo: true, fullName: true } });
  const eBy = new Map(emps.map((e) => [e.employeeNo, e]));
  // approver — HR Manager MII000004
  const hrMgr = eBy.get("MII00004");

  let created = 0;
  for (const s of SEED) {
    const exists = await db.leaveRequest.findFirst({ where: { docNo: s.docNo }, select: { id: true } });
    if (exists) continue;
    const type = tBy.get(s.type);
    const emp = eBy.get(s.emp);
    if (!type || !emp) { console.warn(`  ! lewati ${s.docNo}: ${!type ? `jenis ${s.type}` : `karyawan ${s.emp}`} tidak ditemukan`); continue; }
    const from = D(s.from);
    const to = D(s.to);
    const decided = s.status === "Approved" || s.status === "Rejected" || s.status === "Cancelled";
    await db.leaveRequest.create({
      data: {
        docNo: s.docNo,
        employeeId: emp.id,
        leaveTypeId: type.id,
        year: from.getFullYear(),
        requestDate: new Date(from.getTime() - 10 * 24 * 3600 * 1000),
        dateFrom: from,
        sessionFrom: s.sf ?? "AM",
        dateTo: to,
        sessionTo: s.st ?? "PM",
        workingDays: workdays(from, to),
        balanceAtRequest: type.entitlement,
        remainingAtRequest: type.entitlement - workdays(from, to),
        backToWorkDate: new Date(to.getTime() + 24 * 3600 * 1000),
        status: s.status,
        source: s.source ?? "Admin",
        reason: s.reason,
        note: s.note ?? null,
        ...(decided && hrMgr ? { decidedById: hrMgr.id, decidedAt: new Date(from.getTime() - 8 * 24 * 3600 * 1000) } : {}),
        ...(s.status === "Approved" ? { decisionNote: "Disetujui — dokumen pendukung lengkap" } : {}),
      },
    });
    created++;
    console.log(`[2] ${s.docNo} ${s.emp} ${s.type} ${s.from}→${s.to} (${workdays(from, to)} hr) ${s.status}`);
  }
  console.log(`[2] selesai — ${created} permintaan baru (total seed ${SEED.length})`);

  // ---------- 3. Saldo CT-SAKIT utk semua karyawan aktif ----------
  // (listBalances hanya menampilkan baris LeaveBalance yang ada — tanpa baris
  //  ini laporan R1.1 dgn jenis CT-SAKIT akan kosong.)
  const year = new Date().getFullYear();
  const actives = await db.employee.findMany({ where: { status: "Active" }, select: { id: true, employeeNo: true } });
  let bal = 0;
  for (const e of actives) {
    const exists = await db.leaveBalance.findFirst({
      where: { employeeId: e.id, leaveTypeId: sakit.id, year },
      select: { id: true },
    });
    if (exists) continue;
    await db.leaveBalance.create({
      data: { employeeId: e.id, leaveTypeId: sakit.id, year, carriedOver: 0, note: "saldo cuti sakit (SKD)" },
    });
    bal++;
  }
  console.log(`[3] saldo CT-SAKIT ${year}: ${bal} baris baru (${actives.length} karyawan aktif)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
