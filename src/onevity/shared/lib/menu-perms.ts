// OneVity — HAK AKSI MENU PER PENGGUNA (Task 32) ============================
// =====================================================================
// Hak akses menu tidak berhenti di "boleh membuka menu X" — turun ke
// level AKSI: view (lihat), new (bari), edit (ubah), delete (hapus),
// plus OPERASI SPESIFIK tiap menu (mis. menyetujui pengajuan, menghitung
// payroll, settlement klaim) yang masing-masing bisa diizinkan / tidak —
// per pengguna, bukan per grup.
//
// Format penyimpanan UserMenuAccess.menusJson (mode CUSTOM):
//   {
//     "hr:directory": { view, create, update, delete, ops: { export: true } },
//     ...
//   }
// Kompatibilitas: array string legacy (Task 31) dibaca sebagai menu dengan
// SELURUH aksi aktif. Key menu = "module:view" (sama kunci nav AppShell).
// Berkas ini CLIENT-SAFE (tanpa import server) — dipakai UI + service.
// =====================================================================

// ---------- aksi dasar CRUD ----------

export type MenuAction = "view" | "create" | "update" | "delete";

export const MENU_ACTION_DEFS: { key: MenuAction; label: string; hint: string }[] = [
  { key: "view", label: "Lihat", hint: "Membuka menu dan melihat data di dalamnya" },
  { key: "create", label: "Baru", hint: "Menambahkan data baru (tombol tambah / ajukan)" },
  { key: "update", label: "Ubah", hint: "Mengubah data yang sudah ada" },
  { key: "delete", label: "Hapus", hint: "Menghapus data" },
];

/** Label aksi untuk pesan (server & UI). */
export const ACTION_LABEL: Record<MenuAction, string> = {
  view: "Lihat",
  create: "Baru",
  update: "Ubah",
  delete: "Hapus",
};

// ---------- struktur perizinan per menu ----------

export interface MenuPerm {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Operasi khusus menu — key → boleh/tidak. Nilai tidak ada = boleh. */
  ops: Record<string, boolean>;
}

/** Izin penuh: semua aksi CRUD + seluruh operasi menu. */
export function fullPerm(ops: Record<string, boolean> = {}): MenuPerm {
  return { view: true, create: true, update: true, delete: true, ops };
}

/** Tidak ada izin sama sekali (menu tak terdaftar). */
export function noPerm(): MenuPerm {
  return { view: false, create: false, update: false, delete: false, ops: {} };
}

export type MenusMap = Record<string, MenuPerm>;

/** Daftar key menu yang boleh dilihat (kompatibel bentuk lama `menus`). */
export function viewListOf(map: MenusMap): string[] {
  return Object.entries(map).filter(([, p]) => p.view).map(([k]) => k);
}

// ---------- katalog OPERASI SPESIFIK per menu ----------
// Key = "module:view" nav; verbs selaras endpoint API nyata
// (approve/reject → satu izin "approve" = hak memutuskan).

export interface MenuOpDef {
  key: string;
  label: string;
  hint?: string;
}

export const MENU_OPS: Record<string, MenuOpDef[]> = {
  // HR — kotak persetujuan personnel action
  "hr:inbox": [{ key: "approve", label: "Menyetujui / menolak pengajuan", hint: "Aksi Setujui & Tolak di kotak persetujuan" }],

  // Task 65 — checklist onboarding/offboarding: centang lintas bagian khusus koordinator
  "hr:onboarding-checklist": [
    { key: "coordinate", label: "Koordinator checklist", hint: "Mencentang tugas semua bagian, tambah/hapus tugas, tutup proses" },
  ],
  "hr:all": [{ key: "approve", label: "Menyetujui / menolak pengajuan", hint: "Aksi Setujui & Tolak pada daftar semua pengajuan" }],

  // Payroll — proses run & benefit
  "payroll:runs": [
    { key: "calculate", label: "Menghitung payroll", hint: "Menjalankan kalkulasi run gaji" },
    { key: "confirm", label: "Finalisasi run", hint: "Mengunci & memfinalisasi hasil payroll" },
    { key: "markPaid", label: "Menandai dibayar", hint: "Menandai run sudah dibayarkan" },
    { key: "cancel", label: "Membatalkan run", hint: "Membatalkan run payroll draft" },
    { key: "export", label: "Mengekspor slip & hasil", hint: "Mengunduh slip gaji / hasil run" },
  ],
  "payroll:benefits": [
    { key: "approve", label: "Menyetujui / menolak klaim benefit", hint: "Memutuskan klaim benefit karyawan" },
    { key: "schedule", label: "Menjadwalkan pembayaran", hint: "Menjadwalkan klaim ke periode bayar" },
    { key: "markPaid", label: "Menandai dibayar", hint: "Menandai klaim benefit terbayar" },
  ],

  // Attendance — persetujuan kehadiran
  "attendance:overtime": [{ key: "approve", label: "Menyetujui / menolak lembur", hint: "Memutuskan pengajuan lembur (overtime)" }],
  "attendance:workoff": [{ key: "approve", label: "Menyetujui / menolak work off", hint: "Memutuskan izin work off" }],
  "attendance:assignment-schedule": [{ key: "end", label: "Mengakhiri penugasan jadwal", hint: "Mengakhiri assign jadwal karyawan" }],

  // Leave
  "leave:leave-request": [{ key: "cancel", label: "Membatalkan pengajuan cuti", hint: "Membatalkan permintaan cuti (draft/pending)" }],
  "leave:leave-approval": [{ key: "approve", label: "Menyetujui / menolak cuti", hint: "Aksi Setujui & Tolak pada persetujuan cuti" }],
  "leave:leave-encashment": [{ key: "approve", label: "Menyetujui / menolak encashment", hint: "Memutuskan pengajuan uang pengganti cuti" }],

  // Travel
  "travel:travel-request": [{ key: "cancel", label: "Membatalkan permintaan travel", hint: "Membatalkan permintaan perjalanan dinas" }],
  "travel:travel-approval": [{ key: "approve", label: "Menyetujui / menolak travel", hint: "Aksi Setujui & Tolak pada persetujuan travel" }],
  "travel:travel-claim": [{ key: "cancel", label: "Membatalkan klaim travel", hint: "Membatalkan klaim & settlement" }],
  "travel:travel-claim-approval": [
    { key: "approve", label: "Menyetujui / menolak klaim", hint: "Memutuskan klaim & settlement travel" },
    { key: "transfer", label: "Transfer dana settlement", hint: "Menandatangani transfer dana klaim disetujui" },
  ],

  // Medical
  "medical:medical-claim": [
    { key: "submit", label: "Mengajukan klaim ke settlement", hint: "Mengirim klaim ke proses persetujuan" },
    { key: "cancel", label: "Membatalkan klaim medis", hint: "Membatalkan klaim yang belum diputuskan" },
  ],
  "medical:medical-approval": [
    { key: "approve", label: "Menyetujui / menolak / mengembalikan klaim", hint: "Memutuskan nasib klaim medis" },
    { key: "settle", label: "Settlement klaim", hint: "Menyelesaikan klaim (dibayarkan ke provider)" },
  ],
  "medical:medical-adjustment": [{ key: "approve", label: "Menyetujui / menolak penyesuaian saldo", hint: "Memutuskan penyesuaian saldo medis" }],

  // Task 52-f — whistleblowing TPKS: triase & memutuskan laporan (form Lapor
  // sendiri tanpa guard menu — cukup sesi; menu key whistleblowing:report
  // publik view-only lihat public-menus.ts).
  "whistleblowing:triage": [
    { key: "assign", label: "Menugaskan penangan laporan", hint: "Menetapkan penanggung jawab investigasi laporan" },
    { key: "decide", label: "Memutuskan status & hasil laporan", hint: "Menerima, investigasi, menyelesaikan, atau menutup laporan" },
  ],

  // Settings — konfigurasi email (Task 34)
  "settings:email": [
    { key: "test", label: "Mengirim email uji", hint: "Tombol Tes Kirim pada konfigurasi SMTP" },
  ],

  // Settings — API key & webhook publik (T18-API)
  "settings:api": [
    { key: "test", label: "Menguji kirim webhook", hint: "Tombol Uji Kirim pada endpoint webhook" },
    { key: "revoke", label: "Mencabut kunci API", hint: "Mencabut (revoke) kunci Public API" },
  ],

  // Settings — audit trail viewer (26-b P0): ekspor log aktivitas
  "settings:audit": [
    { key: "export", label: "Mengekspor log aktivitas", hint: "Tombol Export CSV pada Log Aktivitas (Pengaturan)" },
  ],

  // HR — Dokumen & Surat (26-a): memutuskan permintaan surat karyawan (ESS)
  "hr:templates": [
    { key: "decide", label: "Menyetujui / menolak permintaan surat", hint: "Tab Permintaan Masuk pada menu Template Surat — terbitkan atau tolak permintaan surat karyawan" },
  ],

  // wave 27 — aset: menugaskan & menerima kembali aset perusahaan
  "hr:assets": [
    { key: "assign", label: "Menugaskan aset ke karyawan", hint: "Dialog tugaskan aset (laptop, seragam, alat kerja) ke karyawan" },
    { key: "return", label: "Menerima pengembalian aset", hint: "Aksi kembalikan aset + catat kondisi (Baik/Rusak/Hilang)" },
  ],

  // wave 27 — pengumuman: mempublikasikan broadcast ke seluruh ESS
  "hr:announcements": [
    { key: "publish", label: "Mempublikasikan pengumuman", hint: "Menerbitkan pengumuman agar terlihat seluruh karyawan ESS" },
  ],

  // wave 27 — attendance: tukar shift (ESS mengajukan, admin memutuskan)
  "attendance:shift-swap": [
    { key: "approve", label: "Menyetujui / menolak tukar shift", hint: "Memutuskan permintaan tukar shift antar karyawan (approval menukar jadwal kedua pihak)" },
  ],

  // wave 27 — attendance: import log mesin absen
  "attendance:machine-import": [
    { key: "import", label: "Mengimport log mesin absen", hint: "Tombol import file CSV/Excel log presensi mesin (sidik jari/face)" },
  ],

  // wave 28 — WhatsApp: mengirim pesan uji
  "settings:whatsapp": [
    { key: "test", label: "Mengirim pesan WhatsApp uji", hint: "Tombol Tes Kirim pada konfigurasi provider WhatsApp" },
  ],

  // wave 28 — report builder: menjalankan & mengekspor laporan kustom
  "hr:custom-reports": [
    { key: "run", label: "Menjalankan laporan kustom", hint: "Tombol Jalankan pada laporan kustom tersimpan" },
    { key: "export", label: "Mengekspor hasil laporan", hint: "Tombol ekspor CSV/Excel hasil laporan kustom" },
  ],
};

/** Operasi khusus yang terdaftar untuk sebuah key menu. */
export function opsOf(menuKey: string): MenuOpDef[] {
  return MENU_OPS[menuKey] ?? [];
}

// ---------- normalisasi & sanitasi ----------

function sanitizeOps(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function sanitizePerm(raw: unknown): MenuPerm {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    view: o.view !== false, // legacy tolerant: tidak ada = true
    create: o.create !== false,
    update: o.update !== false,
    delete: o.delete !== false,
    ops: sanitizeOps(o.ops),
  };
}

/**
 * Baca menusJson aman → MenusMap.
 * - array string (legacy Task 31) → tiap menu berizin PENUH
 * - object map (Task 32) → sanitasi boolean
 * - rusak → map kosong
 */
export function normalizeMenusJson(json: string): MenusMap {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) {
      const map: MenusMap = {};
      for (const k of v) {
        if (typeof k === "string" && k.includes(":")) map[k] = fullPerm();
      }
      return map;
    }
    if (v && typeof v === "object") {
      const map: MenusMap = {};
      for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
        if (k.includes(":")) map[k] = sanitizePerm(raw);
      }
      return map;
    }
  } catch {
    // JSON rusak → kosong
  }
  return {};
}

/**
 * Sanitasi input POST editor: menerima
 * - string[] (bentuk lama → izin penuh)
 * - Record<menuKey, MenuPerm-ish> (eksplisit; view dipaksa true — kehadiran
 *   key berarti menu diizinkan)
 */
export function sanitizeMenusInput(raw: unknown): MenusMap {
  if (Array.isArray(raw)) {
    const map: MenusMap = {};
    for (const k of raw) {
      if (typeof k === "string" && k.includes(":")) map[k] = fullPerm();
    }
    return map;
  }
  if (raw && typeof raw === "object") {
    const map: MenusMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!k.includes(":")) continue;
      const p = sanitizePerm(v);
      map[k] = { ...p, view: true }; // hadir = boleh lihat
    }
    return map;
  }
  return {};
}

/** Apakah aksi dasar CRUD diizinkan pada perm ini? */
export function actionAllowed(perm: MenuPerm | undefined, action: MenuAction): boolean {
  if (!perm) return false;
  switch (action) {
    case "view": return perm.view;
    case "create": return perm.create;
    case "update": return perm.update;
    case "delete": return perm.delete;
  }
}

/** Apakah sebuah operasi khusus diizinkan? (tidak disebut = boleh) */
export function opAllowed(perm: MenuPerm | undefined, opKey: string): boolean {
  if (!perm) return false;
  return perm.ops[opKey] !== false;
}
