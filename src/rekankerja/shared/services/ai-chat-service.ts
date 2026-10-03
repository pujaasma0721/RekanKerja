// =====================================================================
// RekanKerja — AI CHAT SERVICE (Task 96) ==============================
// =====================================================================
// Chatbot pintar dengan DISIPLIN SCOPE (permintaan user):
//  1. AI hanya menjawab hal seputar APLIKASI RekanKerja.
//  2. Menu yang boleh dibahas = menu yang DAPAT DIAKSES pengguna
//     (resolveMenuPerms — ALL/super admin/CUSTOM). Menu di luar akses →
//     ditolak sopan + arahkan ke admin/pemilik menu.
//  3. Pengecualian #1: DATA PRIBADI pengguna sendiri selalu boleh
//     (sisa jatah cuti, profil, rekap presensi bulan ini…).
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

    // rekap presensi bulan berjalan
    const monthStart = new Date(year, new Date().getMonth(), 1);
    const att = await db.attendanceDaily.findMany({
      where: { employeeId, workDate: { gte: monthStart } },
      select: { status: true },
    }).catch(() => [] as { status: string }[]);
    const attCount = att.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    const attLine = Object.entries(attCount).map(([s, n]) => `${s}: ${n} hari`).join(", ") || "belum ada data bulan ini";

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
      `Presensi bulan berjalan: ${attLine}`,
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
3. PENGECUALIAN DATA PRIBADI: pertanyaan tentang data DIRI SENDIRI pengguna selalu boleh dijawab dari "DATA PRIBADI PENGGUNA" di bawah (sisa jatah cuti, presensi, profil, uang muka & klaim perjalanan dinas).
4. PENGECUALIAN PERATURAN: pertanyaan PERATURAN PEMERINTAH RI bidang ketenagakerjaan yang relevan dengan aplikasi BOLEH dijawab (UU 13/2003 Ketenagakerjaan, PP 35/2021 PKWT, UU 12/2022 TPKS, BPJS Kesehatan/Ketenagakerjaan, PPh 21 & TER PMK 168/2023, UMP/UMK, cuti melahirkan, SKB 3 menteri hari libur). Selalu sarankan verifikasi ke aturan resmi/HR.
5. TOPIK LAIN (cuaca, resep, kode umum, matematika acak, gosip, politik, dll) → tolak satu kalimat singkat + arahkan kembali ke topik RekanKerja.
6. Bahasa: ikuti bahasa pengguna (utamanya Bahasa Indonesia). Jawaban ringkas, terstruktur, berani menyebut angka dari data.
7. JANGAN mengarang fitur/angka yang tidak ada di konteks. Bila tidak tahu, katakan apa adanya.
`.trim();

const HR_EXPERT_RULES = `
PERSONA TAMBAHAN (MODE AHLI HR): Anda adalah konsultan HR senior spesialis ketenagakerjaan Indonesia.
- Fokus jawaban: hukum ketenagakerjaan RI, best-practice HR, kebijakan internal yang ada di BASIS PENGETAHuan, serta aspek HR di aplikasi RekanKerja.
- Kutip dasar regulasi bila relevan (UU/PP/PMK + pasal bila yakin) — bila tidak yakin nomor pasal, jelaskan substansinya saja tanpa mengarang angka pasal.
- Tetap TIDAK menjawab topik non-HR (cuaca, kode, hiburan umum).
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
    input.mode === "hr_expert" ? HR_EXPERT_RULES : "",
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
