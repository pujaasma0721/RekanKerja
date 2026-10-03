// =====================================================================
// RekanKerja — AI CHAT SERVICE (Task 96) ==============================
// =====================================================================
// Chatbot pintar dengan DISIPLIN SCOPE (permintaan user):
//  1. AI hanya menjawab hal seputar APLIKASI RekanKerja.
//  2. Menu yang boleh dibahas = menu yang DAPAT DIAKSES pengguna
//     (resolveMenuPerms — ALL/super admin/CUSTOM). Menu di luar akses →
//     ditolak sopan + arahkan ke admin/pemilik menu.
//  3. Pengecualian #1: DATA PRIBADI pengguna sendiri selalu boleh
//     (sisa jatah cuti, profil, presensi detail bulan berjalan — telat,
//     absen, lembur, riwayat 7 hari, estimasi potongan, aturan selfie/
//     geofence (Task 100 G28) — uang muka/klaim perjalanan dinas).
//  4. Pengecualian #2: PERATURAN PEMERINTAH RI bidang ketenagakerjaan
//     yang relevan dgn aplikasi (UU 13/2003, PP 35/2021, UU 12/2022 TPKS,
//     BPJS, PPh 21/TER PMK 168/2023, UMP/UMK, SKB 3 menteri) boleh
//     dijawab — terutama di mode "Ahli HR".
//  5. Topik lain (cuaca, kode umum, gosip…) → tolak + arahkan ke RekanKerja.
// Konteks disuntikkan ke system prompt: daftar menu + snapshot data diri
// + dokumen basis pengetahuan aktif (RAG skor kata-kunci sederhana).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { readVerifiedSession } from "@/rekankerja/shared/lib/auth";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { db as platformDb } from "@/lib/db";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "@/rekankerja/shared/services/access-scope";
import { normalizeMenusJson, type MenusMap } from "@/rekankerja/shared/lib/menu-perms";
import { listBalances } from "@/rekankerja/leave/services/leave-service";
import { aiComplete, type AiMessage } from "@/rekankerja/shared/services/ai-provider";

export type AiChatMode = "assistant" | "hr_expert";

// ============ AKTOR AI (sesi → tenant db → AppUser → akses menu) ============

export interface AiActor {
  db: TenantDb;
  userId: string;
  name: string;
  email: string;
  platformRole: string;
  appUserId: string | null;
  employeeId: string | null;
  isSuperAdmin: boolean;
  allMenus: boolean;
  menus: string[]; // key "module:view" bila CUSTOM
}

/** Resolusi aktor + akses menu (mirror resolveMe user-menu-access, untuk chat). */
export async function resolveAiActor(req: Request): Promise<AiActor | null> {
  const payload = await readVerifiedSession(req);
  if (!payload?.uid || !payload.tid) return null;

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: { role: true, user: { select: { name: true, email: true } }, tenant: { select: { schemaName: true, status: true } } },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") return null;

  const db = getTenantClient(membership.tenant.schemaName);
  let appUser: { id: string; employeeId: string | null; role: string } | null = null;
  try {
    appUser = membership.user.email
      ? await db.appUser.findFirst({ where: { email: membership.user.email }, select: { id: true, employeeId: true, role: true } })
      : null;
  } catch {
    appUser = null;
  }

  const isSuperAdmin =
    (appUser != null && SUPER_ADMIN_APP_ROLES.includes(appUser.role)) ||
    SUPER_ADMIN_PLATFORM_ROLES.includes(membership.role);

  let allMenus = isSuperAdmin;
  let menus: string[] = [];
  if (!isSuperAdmin && appUser) {
    try {
      const row = await db.userMenuAccess.findUnique({ where: { appUserId: appUser.id }, select: { mode: true, menusJson: true } });
      if (row?.mode === "ALL") allMenus = true;
      else if (row) menus = Object.keys(normalizeMenusJson(row.menusJson));
    } catch {
      /* tabel belum ada → tanpa menu (mode ESS murni) */
    }
  }

  return {
    db,
    userId: payload.uid,
    name: membership.user.name,
    email: membership.user.email,
    platformRole: membership.role,
    appUserId: appUser?.id ?? null,
    employeeId: appUser?.employeeId ?? null,
    isSuperAdmin,
    allMenus,
    menus,
  };
}

// ============ LABEL MENU (untuk prompt yang manusiawi) ============

const MODULE_LABELS: Record<string, string> = {
  hr: "Human Resource Base", payroll: "Payroll", attendance: "Attendance",
  leave: "Leave (Cuti)", travel: "Travel (Perjalanan Dinas)",
  medical: "Medical", whistleblowing: "Whistleblowing", settings: "Pengaturan Sistem",
};

const VIEW_LABELS: Record<string, string> = {
  // HR
  "overview": "Dashboard", "companies": "Perusahaan", "offices": "Kantor & Lokasi Kerja",
  "tree": "Unit Organisasi", "chart": "Peta Organisasi", "list": "Daftar Posisi",
  "jobs": "Katalog Jabatan", "grades": "Grade & Level", "levels": "Level Jabatan",
  "directory": "Direktori Karyawan", "wizard": "Onboarding Karyawan", "onboarding-checklist": "Checklist Onboarding",
  "disciplinary": "Catatan Disiplin", "documents": "Dokumen Karyawan", "assets": "Aset Karyawan",
  "offboarding": "Offboarding Karyawan", "inbox": "Menunggu Persetujuan", "all": "Semua Pengajuan",
  "templates": "Template Surat", "announcements": "Pengumuman", "reports": "Laporan",
  "custom-reports": "Laporan Kustom",
  // Payroll
  "periods": "Periode Payroll", "runs": "Run Payroll", "components": "Komponen Upah",
  "profiles": "Profil Payroll Karyawan", "transactions": "Transaksi", "benefits": "Benefit & Klaim",
  "spt": "SPT Tahunan", "parameters": "Parameter Payroll", "accounting": "Akuntansi Payroll",
  "journals": "Jurnal Payroll",
  // Attendance
  "schedules": "Jadwal Kerja", "matrix": "Matriks Jadwal", "holidays": "Kalender Libur",
  "clocking": "Data Presensi", "liveboard": "Liveboard", "absence": "Rekap Absensi",
  "overtime": "Lembur", "workoff": "Izin Tidak Masuk", "shift-swap": "Tukar Shift",
  "machine-import": "Import Mesin Absen",
  // Leave
  "leave-info": "Informasi Cuti (Saldo)", "leave-request": "Permintaan Cuti",
  "leave-approval": "Persetujuan Cuti", "leave-mass": "Cuti Massal (SKB)",
  "leave-type": "Jenis Cuti", "leave-encashment": "Uang Pengganti Cuti", "leave-reports": "Laporan Cuti",
  // Travel
  "travel-request": "Permintaan Travel", "travel-approval": "Persetujuan Travel",
  "travel-claim": "Klaim & Settlement", "travel-claim-approval": "Approval Klaim & Transfer",
  "travel-budget": "Budget Travel", "travel-templates": "Master Travel", "travel-reports": "Laporan Travel",
  // Medical
  "medical-info": "Saldo Medis Karyawan", "medical-claim": "Klaim Medis",
  "medical-approval": "Persetujuan & Settlement", "medical-adjustment": "Penyesuaian Saldo",
  "medical-benefit-type": "Jenis Benefit", "medical-providers": "Rumah Sakit & Asuransi",
  "medical-reports": "Laporan Medis",
  // Whistleblowing
  "report": "Laporkan Pelanggaran", "triage": "Kelola Laporan",
  // Settings
  "lookups": "Data Master", "security": "Keamanan & Akses", "approval": "Approval Berjenjang",
  "email": "Konfigurasi Email", "whatsapp": "Notifikasi WhatsApp", "api": "API & Integrasi",
  "audit": "Log Aktivitas", "esign": "eSign",
  "ai-provider": "Provider AI", "ai-knowledge": "Basis Pengetahuan AI",
};

/** "hr:directory" → "Human Resource Base · Direktori Karyawan". */
function prettyMenuKey(key: string): string {
  const [mod, ...rest] = key.split(":");
  const view = rest.join(":");
  const m = MODULE_LABELS[mod] ?? mod;
  const v = VIEW_LABELS[view] ?? view.replace(/-/g, " ");
  return `${m} — ${v}`;
}

// ============ SNAPSHOT DATA PRIBADI (untuk prompt) ============

async function selfDataSnapshot(db: TenantDb, employeeId: string | null): Promise<string> {
  if (!employeeId) return "(pengguna ini tidak terhubung ke data karyawan — mode admin murni)";
  try {
    const year = new Date().getFullYear();
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        fullName: true, employeeNo: true, joinDate: true, status: true, gender: true,
        positionId: true, orgUnitId: true,
        position: { select: { title: true } },
        orgUnit: { select: { name: true } },
      },
    });
    if (!emp) return "(data karyawan tidak ditemukan)";

    // saldo cuti tahun berjalan (padanan ESS "Klaim Saya" → sisa jatah)
    const balances = await listBalances(db, { employeeId, year }).catch(() => []);
    const female = emp.gender === "F";
    // Task 99 (F2) — info pintar tambahan: bawaan yang hangus 31 Des + jumlah
    // pengajuan yang menunggu persetujuan (jawab "kapan sisa saya hangus?").
    const pendingLeaveCount = await db.leaveRequest
      .count({ where: { employeeId, status: "Submitted" } })
      .catch(() => 0);
    const carryForfeitLines = balances
      .filter((b) => female || !["CT-LAHIR-P", "CT-GUGUR-P"].includes(b.leaveTypeCode))
      .filter((b) => b.carriedOver > 0)
      .map((b) => `- ${b.leaveTypeName}: ${b.carriedOver} ${b.unit.toLowerCase()} BAWAAN akan HANGUS 31 Des ${year} bila tidak dipakai`);
    const leaveLines = balances
      .filter((b) => female || !["CT-LAHIR-P", "CT-GUGUR-P"].includes(b.leaveTypeCode))
      .map((b) => `- ${b.leaveTypeName}: sisa ${b.remaining} ${b.unit.toLowerCase()} (hak ${b.entitlement}, terpakai ${b.taken}, diajukan menunggu ${b.applied})`)
      .join("\n");

    // Task 100 (G28, F2) — presensi bulan berjalan DETAILED: rekap diperdalam
    // (menit telat total, hari telat/absen, izin unpaid, jam kerja normal,
    // jam lembur dari order disetujui), estimasi dampak payroll best-effort,
    // riwayat 7 hari terakhir, klaim lembur menunggu verifikasi, dan aturan
    // geofence/selfie tenant. Menggantikan hitungan status sederhana Task 96
    // (ringkasan status tetap ada — baris pertama blok).
    const attendanceLines = await attendanceSelfDetail(db, employeeId).catch(() => [] as string[]);

    // Task 98 (F2-1) — snapshot perjalanan dinas: uang muka beredar + jatuh tempo
    // settlement terdekat + status klaim terakhir → karyawan bisa tanya "berapa
    // uang muka saya yang belum settle?" dan dijawab data nyata.
    const travelLine = await travelSelfLine(db, employeeId).catch(() => "");

    return [
      `Nama: ${emp.fullName} (NIK ${emp.employeeNo}) — status ${emp.status}`,
      `Posisi: ${emp.position?.title ?? "-"} · Unit: ${emp.orgUnit?.name ?? "-"} · Mulai kerja: ${emp.joinDate.toISOString().slice(0, 10)}`,
      `Saldo cuti ${year}:\n${leaveLines || "- belum ada baris saldo (jenis event dibuat otomatis saat pengajuan)"}`,
      ...(carryForfeitLines.length > 0 ? [`Peringatan hangus (carry-over):\n${carryForfeitLines.join("\n")}`] : []),
      `Pengajuan cuti menunggu persetujuan: ${pendingLeaveCount}`,
      ...attendanceLines,
      ...(travelLine ? [travelLine] : []),
    ].join("\n");
  } catch {
    return "(snapshot data pribadi gagal dibaca)";
  }
}

/** Task 98 (F2-1) — baris data travel milik karyawan utk snapshot chatbot:
 *  uang muka beredar (advance Given tanpa klaim Paid), jatuh tempo settlement
 *  terdeakt (overdue ditandai), dan klaim terakhir. Terenkripsi (M-8) → dekripsi. */
async function travelSelfLine(db: TenantDb, employeeId: string): Promise<string> {
  const { tenantCryptoForDb } = await import("@/rekankerja/shared/lib/field-crypto");
  const tc = tenantCryptoForDb(db);
  const fmtD = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const fmtR = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const reqs = await db.travelRequest.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      advances: true,
      destinations: { orderBy: { seq: "asc" }, take: 1, select: { city: true } },
      template: { select: { settlementDay: true } },
      claims: { orderBy: { createdAt: "desc" }, take: 1, select: { docNo: true, status: true, totalSettlement: true } },
    },
  });
  if (reqs.length === 0) return "";
  const open = reqs.filter((r) => r.status === "Approved");
  let advancesOutstanding = 0;
  const dueLines: string[] = [];
  for (const r of open) {
    const adv = r.advances
      .filter((x) => (x.status ?? "Given") !== "Void")
      .reduce((s, x) => s + (tc.decryptMoney(x.amount) ?? 0), 0);
    const settled = r.claims[0]?.status === "Paid";
    if (adv > 0 && !settled) advancesOutstanding += adv;
    if (r.template.settlementDay > 0 && !r.claimRequestedAt) {
      const due = new Date(r.dateTo);
      due.setDate(due.getDate() + r.template.settlementDay);
      if (r.claims[0]?.status !== "Paid") {
        dueLines.push(
          `${r.docNo} (${r.destinations[0]?.city ?? "-"}, kembali ${fmtD(new Date(r.dateTo))}): jatuh tempo klaim ${fmtD(due)}${due.getTime() < Date.now() ? " — SUDAH LEWAT" : ""}`,
        );
      }
    }
  }
  const lastClaim = reqs.flatMap((r) => r.claims)[0] ?? null;
  const parts: string[] = [];
  if (advancesOutstanding > 0) {
    parts.push(`Uang muka perjalanan belum settle: ${fmtR(advancesOutstanding)}`);
  }
  if (dueLines.length > 0) {
    parts.push(`Jatuh tempo settlement:\n- ${dueLines.slice(0, 3).join("\n- ")}`);
  }
  if (lastClaim) {
    parts.push(`Klaim travel terakhir: ${lastClaim.docNo} — status ${lastClaim.status}${lastClaim.totalSettlement ? ` (settlement ${fmtR(tc.decryptMoney(lastClaim.totalSettlement) ?? 0)})` : ""}`);
  }
  return parts.length > 0
    ? `Perjalanan dinas:\n- ${parts.join("\n- ")}`
    : `Perjalanan dinas: ${reqs.length} pengajuan tercatat, tidak ada uang muka beredar`;
}

/** Task 100 (G28, F2) — blok presensi DETAILED milik karyawan utk snapshot
 *  chatbot: rekap bulan berjalan yang diperdalam (menit telat total, hari
 *  telat, hari absen, izin/cuti unpaid, jam kerja normal, jam lembur dari
 *  OvertimeOrder disetujui), estimasi dampak payroll (best-effort, BERLABEL
 *  "estimasi" — bukan angka run final), riwayat 7 hari terakhir, klaim lembur
 *  menunggu verifikasi, dan mode geofence/selfie tenant (supaya chatbot bisa
 *  menjawab "kenapa saya harus foto selfie saat clock?").
 *  Disiplin query: SATU findMany per tabel, window bulan berjalan + ekor
 *  riwayat 7 hari, take wajar. Data HANYA milik karyawan sendiri (anti IDOR). */
async function attendanceSelfDetail(db: TenantDb, employeeId: string): Promise<string[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const histFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6); // 7 hari termasuk hari ini
  const from = histFrom.getTime() < monthStart.getTime() ? histFrom : monthStart; // window gabungan rekap + riwayat

  // (1) AttendanceDaily — SATU query utk rekap bulan berjalan + riwayat 7 hari
  //     (terbaru dulu → slice riwayat tinggal ambil atas; take 40 ≈ ±37 hari window).
  const rows = await db.attendanceDaily.findMany({
    where: { employeeId, workDate: { gte: from, lt: nextMonth } },
    orderBy: { workDate: "desc" },
    take: 40,
    select: {
      workDate: true, status: true, checkIn: true, checkOut: true, notes: true,
      paidFlag: true, lateMinutes: true, normalMinutes: true,
    },
  });
  const monthRows = rows.filter((r) => r.workDate.getTime() >= monthStart.getTime());
  const statusCount = monthRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  let lateMinutes = 0, lateDays = 0, unpaidDays = 0, normalMinutes = 0;
  for (const r of monthRows) {
    lateMinutes += r.lateMinutes;
    if (r.status === "Late") lateDays++;
    // izin/cuti TIDAK dibayar (memotong upah) — deteksi PERSIS recapPeriod:
    // kolom paidFlag hasil regen + fallback notes baris lama; setengah hari = 0,5.
    if (r.status === "OnLeave" || r.status === "WorkOff") {
      const unpaid = r.paidFlag === false || (r.paidFlag === null && r.notes?.includes("tidak dibayar"));
      if (unpaid) unpaidDays += r.notes?.includes("setengah hari") ? 0.5 : 1;
    }
    normalMinutes += r.normalMinutes;
  }

  // (2) OvertimeOrder bulan berjalan (Approved/Paid) — jam lembur diakui:
  //     verifiedMinutes bila sudah diverifikasi admin, else actualMinutes
  //     (pola burnoutRolling / regen daily).
  const otOrders = await db.overtimeOrder.findMany({
    where: { employeeId, overtimeDate: { gte: monthStart, lt: nextMonth }, status: { in: ["Approved", "Paid"] } },
    orderBy: { overtimeDate: "desc" },
    take: 62,
    select: { orderNo: true, status: true, paidRunNo: true, actualMinutes: true, verifiedMinutes: true },
  });
  const otMinutes = otOrders.reduce((s, o) => s + (o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes), 0);
  // klaim lembur menunggu VERIFIKASI jam aktual: sudah disetujui + belum
  // dibayar run payroll + jam aktual belum diverifikasi (verifiedMinutes 0).
  const otPendingVerify = otOrders.filter((o) => o.status === "Approved" && !o.paidRunNo && o.verifiedMinutes <= 0);
  const otPendingMinutes = otPendingVerify.reduce((s, o) => s + o.actualMinutes, 0);

  // (3) AttendanceRule — read-only findFirst TANPA create (snapshot chat tidak
  //     boleh menulis; pola defensif burnoutRolling utk tenant belum termigrasi).
  let rule: {
    geofenceMode: string; geofenceMultiSite: boolean; selfieMode: string;
    faceVerifyMode: string; lateDeductionPerHour: number; otCapMode: string;
    otCapDayHours: number | null; otCapWeekHours: number | null;
  } | null = null;
  try {
    rule = await db.attendanceRule.findFirst({
      orderBy: { id: "asc" },
      select: {
        geofenceMode: true, geofenceMultiSite: true, selfieMode: true, faceVerifyMode: true,
        lateDeductionPerHour: true, otCapMode: true, otCapDayHours: true, otCapWeekHours: true,
      },
    });
  } catch {
    rule = null;
  }

  // (4) gaji pokok penempatan AKTIF milik SENDIRI (enkripsi M-8 → dekripsi) —
  //     murni utk estimasi potongan telat; karyawan lain tidak disentuh.
  const { tenantCryptoForDb } = await import("@/rekankerja/shared/lib/field-crypto");
  const tc = tenantCryptoForDb(db);
  const asg = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    select: { baseSalary: true },
  });
  const baseSalary = tc.decryptMoney(asg?.baseSalary) ?? 0;
  const lateTarif = rule?.lateDeductionPerHour ?? 0; // >0 = tarif potongan telat tetap per jam (rule tenant)
  const perHour = lateTarif > 0 ? lateTarif : baseSalary / 173; // upah sejam 1/173 (default aplikasi)

  const fmtR = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const jam = (m: number) => (m / 60).toLocaleString("id-ID", { maximumFractionDigits: 1 });
  const monthName = monthStart.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const statusLine = Object.entries(statusCount).map(([s, n]) => `${s}: ${n} hari`).join(", ") || "belum ada data bulan ini";

  const lines: string[] = [
    `Presensi bulan berjalan (${monthName}): ${statusLine}`,
    `- Telat: ${lateDays} hari (total ${lateMinutes} menit) · Absen: ${statusCount["Absent"] ?? 0} hari · Izin/cuti tidak dibayar: ${unpaidDays.toLocaleString("id-ID")} hari`,
    `- Jam kerja normal diakui: ${jam(normalMinutes)} jam · Jam lembur diakui: ${jam(otMinutes)} jam (${otOrders.length} order lembur disetujui bulan ini)`,
  ];

  // estimasi dampak payroll — best-effort & BERLABEL estimasi; rumus mirror
  // recapPeriod (menit telat / 60 × upah per jam; tarif tetap bila diatur tenant).
  if (lateTarif > 0 || baseSalary > 0) {
    lines.push(
      `- Estimasi dampak payroll bulan ini (ESTIMASI best-effort, bukan angka final run payroll): potongan telat ≈ ${fmtR((lateMinutes / 60) * perHour)} (${lateMinutes} menit ÷ 60 × upah per jam ${fmtR(perHour)}${lateTarif > 0 ? " — tarif tetap rule tenant" : " = 1/173 gaji pokok"}). Potongan absen/izin tidak dibayar dihitung lengkap oleh run payroll — angka final hubungi HR.`,
    );
  } else {
    lines.push("- Estimasi potongan telat bulan ini: hubungi HR (data upah utk estimasi tidak terbaca aplikasi).");
  }

  // riwayat 7 hari terakhir — dari AttendanceDaily + jam check-in/out.
  const fmtDay = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  const fmtT = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const hist = rows.filter((r) => r.workDate.getTime() >= histFrom.getTime());
  if (hist.length > 0) {
    const histLines = hist.map((r) => {
      const clock = r.checkIn ? ` ${fmtT(r.checkIn)}${r.checkOut ? `–${fmtT(r.checkOut)}` : ""}` : "";
      if (r.status === "Late") return `${fmtDay(r.workDate)}: Hadir${clock} (telat ${r.lateMinutes} mnt)`;
      if (r.status === "Present") return `${fmtDay(r.workDate)}: Hadir${clock}`;
      if (r.status === "Absent") return `${fmtDay(r.workDate)}: Absen${r.notes ? ` (${r.notes})` : ""}`;
      if (r.status === "OnLeave" || r.status === "WorkOff") {
        return `${fmtDay(r.workDate)}: ${r.notes ?? (r.status === "OnLeave" ? "Cuti" : "Izin")}`;
      }
      return `${fmtDay(r.workDate)}: ${r.notes ?? (r.status === "Off" || r.status === "Holiday" ? "Libur" : r.status)}`;
    });
    lines.push(`Riwayat presensi 7 hari terakhir (terbaru dulu):\n- ${histLines.join("\n- ")}`);
  }
  lines.push(`Klaim lembur menunggu verifikasi jam aktual: ${otPendingVerify.length} order (${jam(otPendingMinutes)} jam)`);

  // aturan clock tenant — supaya chatbot bisa menjawab "kenapa saya harus
  // foto selfie saat clock?" / "apa itu geofence?" dari konfigurasi nyata.
  const gf = rule?.geofenceMode ?? "Off";
  const gfLabel: Record<string, string> = {
    Off: "koordinat tidak diperiksa",
    Warn: "clock di luar radius lokasi dicatat peringatan, clock tetap sah",
    Strict: "clock di luar radius lokasi kerja DITOLAK aplikasi",
  };
  const selfie = rule?.selfieMode ?? "off";
  const selfieLabel: Record<string, string> = {
    off: "selfie tidak diminta saat clock",
    warn: "selfie tanpa foto tetap jalan (ditandai utk ditelaah)",
    required: "selfie WAJIB saat clock — tanpa foto clock ditolak",
  };
  const face = rule?.faceVerifyMode ?? "off";
  const faceLabel: Record<string, string> = {
    off: "verifikasi wajah nonaktif",
    warn: "foto selfie dibandingkan dgn foto referensi (AI) — beda orang ditandai",
    strict: "verifikasi wajah ketat — clock ditolak bila bukan pemilik akun",
  };
  const otCap =
    rule == null || rule.otCapMode === "PP35"
      ? "PP 35/2021 — maks 4 jam/hari & 18 jam/minggu"
      : rule.otCapMode === "KEPMEN102"
        ? "Kepmen 102/2004 — maks 3 jam/hari & 14 jam/minggu"
        : `kustom — maks ${rule.otCapDayHours ?? 4} jam/hari & ${rule.otCapWeekHours ?? 18} jam/minggu`;
  lines.push(
    `Aturan clock-in tenant Anda: geofence ${gf} (${gfLabel[gf] ?? ""}${rule?.geofenceMultiSite ? "; mode multi-lokasi — radius lokasi aktif terdekat yang dipakai" : ""}); ${selfieLabel[selfie] ?? "selfie tidak diminta saat clock"}; ${faceLabel[face] ?? "verifikasi wajah nonaktif"}. Cap lembur: ${otCap}.`,
  );
  return lines;
}

// ============ RAG KNOWLEDGE BASE (skor kata-kunci sederhana) ============

const STOPWORDS = new Set(["yang", "dan", "di", "ke", "dari", "untuk", "dengan", "apa", "bagaimana", "cara", "adalah", "itu", "ini", "saya", "boleh", "apakah", "gimana", "ga", "nggak", "the", "a", "of", "to", "how", "what"]);

async function relevantKnowledge(db: TenantDb, question: string, limit = 3): Promise<string> {
  try {
    const docs = await db.aiKnowledgeDoc.findMany({
      where: { active: true },
      select: { title: true, content: true },
    });
    if (docs.length === 0) return "";
    const terms = question
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    const scored = docs
      .map((d) => {
        const hay = `${d.title}\n${d.content}`.toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
        return { d, score };
      })
      .sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, limit);
    const picked = top.length > 0 ? top : scored.slice(0, 1); // fallback 1 doc teratas bila tak ada kecocokan
    return picked
      .map((s) => `### ${s.d.title}\n${s.d.content.slice(0, 2400)}`)
      .join("\n\n")
      .slice(0, 7200);
  } catch {
    return "";
  }
}

// ============ SYSTEM PROMPT ============

const SCOPE_RULES = `
ATURAN SCOPE (WAJIB — pelanggaran = jawaban salah):
1. HANYA bahas hal seputar APLIKASI RekanKerja (HRIS: karyawan, presensi, cuti, payroll, travel, medical, whistleblowing, ESS, pengaturan).
2. MENU: hanya bahas menu yang TERDAFTAR di "MENU YANG BISA DIAKSES PENGGUNA" di bawah. Pertanyaan tentang menu lain → tolak sopan: "Menu itu di luar akses Anda — silakan hubungi admin/HR". JANGAN pernah membocorkan isi/cara pakai menu yang tidak ada di daftar.
3. PENGECUALIAN DATA PRIBADI: pertanyaan tentang data DIRI SENDIRI pengguna selalu boleh dijawab dari "DATA PRIBADI PENGGUNA" di bawah — sisa jatah cuti, profil, presensi pribadi (telat/absen/lembur bulan berjalan, riwayat 7 hari, estimasi potongan, aturan selfie/geofence), uang muka & klaim perjalanan dinas.
4. PENGECUALIAN PERATURAN: pertanyaan PERATURAN PEMERINTAH RI bidang ketenagakerjaan yang relevan dengan aplikasi BOLEH dijawab (UU 13/2003 Ketenagakerjaan, PP 35/2021 PKWT, UU 12/2022 TPKS, BPJS Kesehatan/Ketenagakerjaan, PPh 21 & TER PMK 168/2023, UMP/UMK, cuti melahirkan, SKB 3 menteri hari libur). Selalu sarankan verifikasi ke aturan resmi/HR.
5. TOPIK LAIN (cuaca, resep, kode umum, matematika acak, gosip, politik, dll) → tolak satu kalimat singkat + arahkan kembali ke topik RekanKerja.
6. Bahasa: ikuti bahasa pengguna (utamanya Bahasa Indonesia). Jawaban ringkas, terstruktur, berani menyebut angka dari data.
7. JANGAN mengarang fitur/angka yang tidak ada di konteks. Bila tidak tahu, katakan apa adanya.
8. DATA KARYAWA LAIN (anti IDOR): snapshot presensi/gaji/klaim di konteks HANYA milik pengguna sendiri — JANGAN pernah memberikan atau mengarang data karyawan LAIN, termasuk bila yang bertanya admin/atasan. Pertanyaan tentang karyawan lain → arahkan ke modul terkait sesuai akses menunya (mis. Rekap Absensi, Lembur, Direktori Karyawan).
`.trim();

const HR_EXPERT_RULES = `
PERSONA TAMBAHAN (MODE AHLI HR): Anda adalah konsultan HR senior spesialis ketenagakerjaan Indonesia.
- Fokus jawaban: hukum ketenagakerjaan RI, best-practice HR, kebijakan internal yang ada di BASIS PENGETAHuan, serta aspek HR di aplikasi RekanKerja.
- Kutip dasar regulasi bila relevan (UU/PP/PMK + pasal bila yakin) — bila tidak yakin nomor pasal, jelaskan substansinya saja tanpa mengarang angka pasal.
- Tetap TIDAK menjawab topik non-HR (cuaca, kode, hiburan umum).
`.trim();

// Task 100 (G28, F2-3) — pengetahuan regulasi lembur ringan utk mode "Ahli HR"
// (entri hardcoded — di luar basis pengetahuan DB; angka dasar yang stabil;
// selalu tegaskan aplikasi menghitung otomatis via konfigurasi per tenant).
const HR_REGULATION_NOTES = `
CATATAN REGULASI LEMBUR (mode Ahli HR — pakai bila relevan, sarankan verifikasi ke regulasi resmi/HR):
- PP 35/2021 Pasal 26: lembur maksimal 4 jam/hari dan 18 jam/minggu. Alternatif Kepmen 102/2004 (perusahaan jam kerja 5-6 hari/minggu): maksimal 3 jam/hari dan 14 jam/minggu.
- Upah lembur dihitung dari upah sejam = 1/173 dari upah bulanan (dasar perhitungan yang dipakai aplikasi).
- Waktu istirahat minimal 30 menit setelah 4 jam lembur berturut-turut.
- Aplikasi RekanKerja MENGHITUNG & MEMVALIDASI batas lembur ini OTOMATIS sesuai mode konfigurasi per tenant (PP35 / KEPMEN102 / CUSTOM — aturan AttendanceRule) saat pengajuan, persetujuan, dan verifikasi.
`.trim();

export interface ChatContextInput {
  mode: AiChatMode;
  question: string;
}

/** Rakit system prompt lengkap untuk satu pertanyaan. */
export async function buildSystemPrompt(db: TenantDb, actor: AiActor, input: ChatContextInput): Promise<string> {
  const menuSection = actor.allMenus
    ? "SEMUA modul & menu RekanKerja (akses penuh admin)."
    : actor.menus.length > 0
      ? actor.menus.map(prettyMenuKey).map((s) => `- ${s}`).join("\n")
      : "(tidak ada menu admin — pengguna portal ESS murni: hanya fitur Employee Self Service: dashboard, cuti, presensi, slip gaji, klaim, pengajuan, surat, pengumuman, tukar shift, aset, pelaporan pelanggaran, profil)";

  const selfData = await selfDataSnapshot(db, actor.employeeId);
  const kb = await relevantKnowledge(db, input.question);

  const parts = [
    "Anda adalah asisten AI internal aplikasi HRIS **RekanKerja** (multi-tenant, Bahasa Indonesia).",
    SCOPE_RULES,
    input.mode === "hr_expert" ? `${HR_EXPERT_RULES}\n\n${HR_REGULATION_NOTES}` : "",
    `IDENTITAS PENGGUNA: ${actor.name} (role workspace: ${actor.platformRole}).`,
    `MENU YANG BISA DIAKSES PENGGUNA:\n${menuSection}`,
    `DATA PRIBADI PENGGUNA (boleh dibahas dengannya):\n${selfData}`,
    kb ? `BASIS PENGETAHUAN PERUSAHAAN (pakai sebagai kebijakan internal bila relevan):\n${kb}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

// ============ CHAT (riwayat + completion + persist) ============

const HISTORY_LIMIT = 12;

export async function chatHistory(db: TenantDb, actor: AiActor, mode: AiChatMode) {
  const rows = await db.aiChatMessage.findMany({
    where: { appUserId: actor.appUserId!, mode },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return rows.reverse();
}

export async function clearHistory(db: TenantDb, actor: AiActor, mode: AiChatMode | "all") {
  await db.aiChatMessage.deleteMany({
    where: mode === "all" ? { appUserId: actor.appUserId! } : { appUserId: actor.appUserId!, mode },
  });
}

export interface ChatReply {
  reply: string;
  mode: AiChatMode;
}

/** Satu putaran chat: simpan pertanyaan → completion (dgn riwayat) → simpan jawaban. */
export async function askAi(db: TenantDb, actor: AiActor, mode: AiChatMode, question: string): Promise<ChatReply> {
  const q = question.trim().slice(0, 4000);
  if (!q) throw new Error("Pertanyaan kosong");

  await db.aiChatMessage.create({ data: { appUserId: actor.appUserId!, mode, role: "user", content: q } });

  const history = await db.aiChatMessage.findMany({
    where: { appUserId: actor.appUserId!, mode }, // non-null: baris user baru dibuat di atas
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });
  const messages: AiMessage[] = history
    .reverse()
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const system = await buildSystemPrompt(db, actor, { mode, question: q });
  const result = await aiComplete(db, { system, messages, temperature: 0.4 });

  await db.aiChatMessage.create({ data: { appUserId: actor.appUserId!, mode, role: "assistant", content: result.text } });
  return { reply: result.text, mode };
}

// ============ KONTAK CHAT (bawahan/atasan via EmployeeAssignment) ============

export interface ChatContact {
  appUserId: string;
  name: string;
  positionTitle: string | null;
  relation: string;
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
}

/** Kontak = atasan langsung + 1 tingkat lagi + bawahan langsung (punya AppUser aktif). */
export async function listChatContacts(db: TenantDb, actor: AiActor): Promise<ChatContact[]> {
  if (!actor.appUserId) return [];
  const me = actor.employeeId;

  // peta employeeId → AppUser aktif
  const users = await db.appUser.findMany({
    where: { active: true, employeeId: { not: null } },
    select: { id: true, fullName: true, employeeId: true },
  }).catch(() => [] as { id: string; fullName: string; employeeId: string | null }[]);
  const userByEmp = new Map<string, { id: string; fullName: string }>();
  for (const u of users) if (u.employeeId) userByEmp.set(u.employeeId, { id: u.id, fullName: u.fullName });

  const relations: Map<string, string> = new Map(); // employeeId → label relasi

  const attach = async (employeeId: string, label: string) => {
    if (!employeeId || relations.has(employeeId) || employeeId === me) return;
    if (!userByEmp.has(employeeId)) return;
    relations.set(employeeId, label);
  };

  if (me) {
    const assignments = await db.employeeAssignment.findMany({
      where: { employeeId: me, validTo: null, managerId: { not: null } },
      select: { managerId: true },
      take: 1,
    }).catch(() => [] as { managerId: string | null }[]);
    const myManager = assignments[0]?.managerId ?? null;

    if (myManager) {
      await attach(myManager, "Atasan langsung");
      const mgrAssignments = await db.employeeAssignment.findMany({
        where: { employeeId: myManager, validTo: null, managerId: { not: null } },
        select: { managerId: true },
        take: 1,
      }).catch(() => [] as { managerId: string | null }[]);
      const grandManager = mgrAssignments[0]?.managerId ?? null;
      if (grandManager) await attach(grandManager, "Atasan (2 tingkat)");
    }

    const reports = await db.employeeAssignment.findMany({
      where: { managerId: me, validTo: null },
      select: { employeeId: true },
    }).catch(() => [] as { employeeId: string }[]);
    for (const r of reports) await attach(r.employeeId, "Bawahan langsung");
  }

  if (relations.size === 0) return [];

  const empIds = [...relations.keys()];
  const employees = await db.employee.findMany({
    where: { id: { in: empIds } },
    select: { id: true, fullName: true, position: { select: { title: true } } },
  }).catch(() => [] as { id: string; fullName: string; position: { title: string | null } | null }[]);
  type EmpRow = { id: string; fullName: string; position: { title: string | null } | null };
  const empById = new Map<string, EmpRow>(employees.map((e: EmpRow) => [e.id, e] as [string, EmpRow]));

  const contacts: ChatContact[] = [];
  for (const [empId, relation] of relations) {
    const u = userByEmp.get(empId)!;
    const e = empById.get(empId);
    // pesan terakhir + unread antara saya ↔ kontak ini (dua arah)
    const msgs = await db.directMessage.findMany({
      where: {
        OR: [
          { senderId: actor.appUserId!, recipientId: u.id },
          { senderId: u.id, recipientId: actor.appUserId! },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { senderId: true, body: true, createdAt: true, readAt: true },
    }).catch(() => [] as { senderId: string; body: string; createdAt: Date; readAt: Date | null }[]);
    const last = msgs[0];
    const unread = msgs.filter((m) => m.senderId === u.id && !m.readAt).length;
    contacts.push({
      appUserId: u.id,
      name: e?.fullName ?? u.fullName,
      positionTitle: e?.position?.title ?? null,
      relation,
      lastMessage: last?.body ?? null,
      lastAt: last?.createdAt.toISOString() ?? null,
      unread,
    });
  }

  // urut: unread dulu, lari pesan terbaru
  return contacts.sort((a, b) => (b.unread - a.unread) || (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

// ============ PESAN LANGSUNG (DM) ============

export interface DmMessage {
  id: string;
  mine: boolean;
  body: string;
  createdAt: string;
}

/** Pesan dua arah saya ↔ partner (asc) + tandai yang masuk sudah dibaca. */
export async function listDm(db: TenantDb, actor: AiActor, partnerAppUserId: string): Promise<DmMessage[]> {
  const rows = await db.directMessage.findMany({
    where: {
      OR: [
        { senderId: actor.appUserId!, recipientId: partnerAppUserId },
        { senderId: partnerAppUserId, recipientId: actor.appUserId! },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, senderId: true, body: true, createdAt: true, readAt: true },
  });
  const list = rows.reverse();
  // tandai dibaca (pesan dari partner yang belum dibaca)
  const unreadIds = list.filter((m) => m.senderId === partnerAppUserId && !m.readAt).map((m) => m.id);
  if (unreadIds.length > 0) {
    await db.directMessage.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } }).catch(() => {});
  }
  return list.map((m) => ({ id: m.id, mine: m.senderId === actor.appUserId, body: m.body, createdAt: m.createdAt.toISOString() }));
}

/** Kirim pesan ke pengguna lain — validasi partner adalah kontak terhubung. */
export async function sendDm(db: TenantDb, actor: AiActor, toAppUserId: string, body: string): Promise<DmMessage> {
  const text = body.trim().slice(0, 2000);
  if (!text) throw new Error("Pesan kosong");
  const partner = await db.appUser.findUnique({ where: { id: toAppUserId }, select: { id: true, fullName: true, employeeId: true, active: true } });
  if (!partner || !partner.active) throw new Error("Penerima tidak ditemukan / tidak aktif");

  // guard relasi: harus muncul di kontak (atasan/bawahan) — cek via assignment employeeId
  if (actor.employeeId && partner.employeeId) {
    const linked = await db.employeeAssignment.findFirst({
      where: {
        validTo: null,
        OR: [
          { employeeId: actor.employeeId, managerId: partner.employeeId },
          { employeeId: partner.employeeId, managerId: actor.employeeId },
        ],
      },
      select: { id: true },
    }).catch(() => null);
    if (!linked) {
      // 2 tingkat ke atas juga boleh
      const chain = await db.employeeAssignment.findMany({
        where: { validTo: null, managerId: { not: null }, employeeId: { in: [actor.employeeId] } },
        select: { managerId: true },
      }).catch(() => [] as { managerId: string | null }[]);
      const myMgr = chain[0]?.managerId ?? null;
      const mgr2 = myMgr
        ? await db.employeeAssignment.findFirst({ where: { employeeId: myMgr, validTo: null, managerId: partner.employeeId }, select: { id: true } }).catch(() => null)
        : null;
      if (!mgr2) throw new Error("Penerima bukan bawahan/atasan Anda yang terhubung");
    }
  }

  const row = await db.directMessage.create({
    data: { senderId: actor.appUserId!, recipientId: toAppUserId, body: text },
  });

  // notifikasi in-app penerima (fire-and-forget)
  const { pushNotification } = await import("@/rekankerja/shared/services/notification-service");
  void pushNotification(db, {
    appUserId: toAppUserId,
    title: `Pesan baru dari ${actor.name}`,
    body: text.slice(0, 120),
    kind: "chat",
  }).catch(() => {});

  return { id: row.id, mine: true, body: row.body, createdAt: row.createdAt.toISOString() };
}
