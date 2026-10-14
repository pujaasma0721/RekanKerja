// RekanKerja — HAK AKSI MENU PER PENGGUNA (Task 32) ============================
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

  // P0-PERF — Performance (DEVELOPMENT-PLAN-PERFORMANCE.md §17/§35/§36):
  // katalog aksi khusus per menu modul Kinerja.
  "performance:cycles": [
    { key: "enroll", label: "Mendaftarkan peserta", hint: "Enroll karyawan Active ke siklus (snapshot atasan penilai)" },
    { key: "openGoal", label: "Membuka fase target", hint: "Membuka jendela penetapan KPI (openGoal)" },
    { key: "advance", label: "Menggerakkan fase siklus", hint: "startOngoing/startAssessment/startCalibration/publish/close" },
    { key: "nudge", label: "Mengirim pengingat (nudge)", hint: "Remind/Remind All multi-kanal dengan deep-link (§18.8, rate-limit D17)" },
  ],
  "performance:goals": [
    { key: "submit", label: "Menyetujui target KPI", hint: "Submit target peserta (kunci — Σbobot 100, 3–8 item)" },
    { key: "copy", label: "Menyalin KPI periode lalu", hint: "copyPreview/copyFromCycle/copyTeam — salin definisi+target, capaian reset (§18.2)" },
    { key: "import", label: "Impor Excel target", hint: "Unduh template, unggah, pratinjau validasi, commit baris valid saja (§18.5)" },
    { key: "revise", label: "Revisi target mid-year", hint: "Revisi target fase Ongoing dengan approval atas (Alur 3)" },
  ],
  "performance:appraisals": [
    { key: "submitManager", label: "Menilai & submit penilaian", hint: "Form atasan: aktual KPI + skor kompetensi + komentar ekstrem" },
    { key: "pullAuto", label: "Menarik data otomatis", hint: "Tarik nilai KPI ber-sumber dari modul lain (§18.6)" },
    { key: "importActuals", label: "Impor realisasi Excel", hint: "Impor finalActual massal — tidak mengubah status (§18.5)" },
    { key: "aiCompose", label: "Menyusun ulasan dengan AI", hint: "AI Assist kolom ulasan — poin → draf kalimat (§18.11, compose-only)" },
    { key: "previewImpact", label: "Melihat estimasi dampak", hint: "Estimasi bonus/kenaikan real-time dari draf nilai (§18.12, tanpa nominal Rp)" },
  ],
  "performance:calibration": [
    { key: "decide", label: "Keputusan kalibrasi", hint: "CalibrationDecision ter-audit (dari → ke, alasan wajib)" },
    { key: "session", label: "Sesi kalibrasi", hint: "Buka/tutup sesi forum penyetaraan standar" },
    { key: "finalize", label: "Finalisasi & persetujuan", hint: "Ajukan/putuskan finalisasi berjenjang PerformanceAppraisal (AS-PERF-STD)" },
  ],
  "performance:results": [
    { key: "publish", label: "Mempublikasikan & menutup hasil", hint: "Publish ke ESS + tutup siklus hasil (Alur 7)" },
    { key: "appeal", label: "Memutuskan banding", hint: "Keputusan banding karyawan (jendela D6)" },
    { key: "merit", label: "Usulan merit & penerapan", hint: "MeritRecommendation → approval nominal → payroll/PA + surat hasil + usul PIP (Alur 8)" },
  ],
  // P6-PERF — PIP end-to-end (§33 Alur 9)
  "performance:pip": [
    { key: "activate", label: "Mengaktivasi PIP", hint: "Mengajukan PIP ke approval AS-PIP-STD dan mengaktifkan program (§33-1)" },
    { key: "checkpoint", label: "Review checkpoint PIP", hint: "Mencatat capaian checkpoint 30/60/90 hari oleh pembina (§33-3)" },
    { key: "extend", label: "Memperpanjang PIP", hint: "Perpanjangan 1× dengan total durasi ≤3 bulan (§35-21)" },
    { key: "outcome", label: "Memutuskan hasil PIP", hint: "Keputusan akhir Recovered/NotRecovered (§35-22)" },
    { key: "create", label: "Membuat PIP manual", hint: "PIP khusus tanpa usulan penilaian, wajib alasan (§35-20)" },
  ],
  "performance:probation": [
    { key: "new", label: "Membuat evaluasi percobaan", hint: "Evaluasi masa percobaan manual (karyawan tanpa evaluasi terbuka — tenggat maks 3 bulan sejak join §7.1)" },
    { key: "assess", label: "Penilaian atasan", hint: "Mengisi skor atasan 0–100 + kriteria bobot 3–6 item" },
    { key: "recommend", label: "Rekomendasi HR", hint: "Confirm / Extend (perjanjian kerja baru — UU 13/2003 Ps.60) / Terminate" },
    { key: "submit", label: "Mengajukan keputusan", hint: "Meneruskan rekomendasi ke jalur persetujuan AS-PROB-STD (L3 Direktur hanya utk Terminate)" },
    { key: "decide", label: "Keputusan masa percobaan", hint: "Confirm/Extend/Terminate + PA + surat" },
    { key: "cancel", label: "Membatalkan evaluasi", hint: "Membatalkan evaluasi percobaan (mis. salah karyawan) — alasan ter-audit" },
  ],
  "performance:masters": [
    { key: "newVersion", label: "Versi baru pustaka", hint: "Simpan definisi KPI/kompetensi sebagai versi baru (§18.9)" },
    { key: "archive", label: "Mengarsipkan definisi", hint: "Arsip lembut — hilang dari picker, data historis tetap terbaca" },
  ],
  "performance:compliance": [
    { key: "dsr", label: "Mengelola DSR karyawan", hint: "Permintaan subjek data UU PDP: akses/ekspor/hapus data kinerja karyawan (§7.3, §37 — SLA 7 hari)" },
  ],

  // F1-REC — Rekrutmen: PR (permintaan karyawan) + kotak approval
  "recruitment:pr": [
    { key: "apply", label: "Mengajukan PR", hint: "Meneruskan draft permintaan karyawan ke jalur approval" },
    { key: "cancel", label: "Membatalkan PR", hint: "Membatalkan PR draft/menunggu persetujuan" },
    { key: "hold", label: "Menahan / lanjut PR", hint: "Menahan sementara (On Hold) atau melanjutkan kembali PR yang disetujui" },
    { key: "close", label: "Menutup PR", hint: "Menutup PR yang disetujui (batal rekrutmen / sudah tidak diperlukan)" },
    { key: "duplicate", label: "Menduplikasi PR", hint: "Menyalin PR menjadi draft baru (termasuk ajukan ulang PR yang ditolak)" },
  ],
  "recruitment:pr-approval": [{ key: "approve", label: "Menyetujui / menolak PR", hint: "Aksi Setujui & Tolak pada kotak persetujuan permintaan karyawan" }],

  // Recruitment F2 — lowongan (JO) & talent pool & staging lamaran publik
  "recruitment:openings": [
    { key: "post", label: "Mempublikasikan lowongan", hint: "Menerbitkan draft lowongan (JO) ke portal karir" },
    { key: "close", label: "Menutup lowongan", hint: "Menutup lowongan beserta slot yang masih terbuka" },
    { key: "obsolete", label: "Menandai lowongan usang", hint: "Mengarsipkan lowongan yang tidak relevan (obsolete)" },
    { key: "knockout", label: "Pertanyaan knockout slot", hint: "Mengelola pertanyaan screening objektif per slot — jawaban salah otomatis menolak lamaran publik (F6)" },
  ],
  "recruitment:applicants": [
    { key: "blacklist", label: "Blacklist / suspend pelamar", hint: "Blacklist (alasan wajib), suspend, atau melepas status pelamar" },
    { key: "apply", label: "Melamar ke slot", hint: "Mendaftarkan pelamar talent pool ke slot lowongan terbuka" },
    { key: "parse-cv", label: "Parsing CV (AI)", hint: "Ekstraksi data CV (paste/dokumen) via AI + verifikasi hasil parsing oleh manusia (F6a)" },
    { key: "search-ai", label: "Pencarian AI talent pool", hint: "Pencarian pelamar bahasa natural (interpretasi AI/simulasi + filter terstruktur) di talent pool (F6c)" },
  ],
  "recruitment:public-staging": [
    { key: "verify", label: "Memverifikasi lamaran publik", hint: "Verifikasi (upload ke talent pool), tolak, atau tandai spam" },
  ],

  // Recruitment F3 — kandidat & proses seleksi terstruktur
  "recruitment:candidates": [
    { key: "nominate", label: "Transfer / nominasi kandidat", hint: "Menambahkan pelamar talent pool atau karyawan internal sebagai kandidat PR" },
    { key: "withdraw", label: "Menarik / menghapus kandidat", hint: "Menarik kandidat dari proses (Withdrawn) atau menghapus transfer yang salah" },
  ],
  "recruitment:selection": [
    { key: "schedule", label: "Menjadwalkan tahap seleksi", hint: "Mengatur jadwal (plan/SLA/evaluator) dan acknowledgement tahap kandidat" },
    { key: "result", label: "Mencatat hasil & memindahkan tahap", hint: "Catat hasil tahap (lulus/gagal/skor) dan naikkan kandidat ke tahap berikutnya (termasuk aksi board kanban)" },
    { key: "invite", label: "Menerbitkan surat undangan", hint: "Terbitkan surat undangan seleksi kandidat (PDF via Template Surat)" },
    { key: "score", label: "Skor AI kandidat", hint: "Generate skor AI explainable per kandidat + kelola rubrik skor per PR (F6 — rekomendasi, keputusan tetap manusia)" },
    { key: "copilot", label: "Recruiter Copilot (AI)", hint: "Asisten AI rekrutmen: draft JD, ringkas kandidat, pertanyaan interview, outreach, tanya-jawab pipeline, cek bias lowongan (F6c)" },
  ],

  // Recruitment F4 — offer & pengangkatan + integrasi onboarding
  "recruitment:offers": [
    { key: "send", label: "Mengirim / memutuskan offer", hint: "Kirim offer ke kandidat (surat penawaran + email) dan putuskan persetujuan offer" },
    { key: "respond", label: "Mencatat respons kandidat", hint: "Catat offer dilihat / diterima / ditolak (termasuk catatan nego)" },
    { key: "appoint", label: "Mengangkat & melanjutkan onboarding", hint: "Buat pengangkatan (surat + penolakan batch) dan lanjutkan ke onboarding karyawan baru" },
  ],

  // Recruitment F5 — rencana & anggaran rekrutmen (demografi view-only)
  "recruitment:plan": [
    { key: "apply", label: "Menerapkan rencana", hint: "Mengaplikasikan baris rencana rekrutmen (Draft → Applied) sebagai dasar justifikasi PR" },
  ],

  // Recruitment F7 — otomasi, integrasi webhook & e-sign kandidat
  "recruitment:settings": [
    { key: "webhook", label: "Mengelola webhook", hint: "Menambah/mengubah/menguji endpoint webhook rekrutmen (event PR, lamaran, offer, hired)" },
    { key: "esign", label: "Permintaan e-sign kandidat", hint: "Membuat/mengirim ulang OTP/membatalkan permintaan tanda tangan elektronik kandidat eksternal" },
    { key: "update", label: "Mengubah pengaturan & preferensi", hint: "Mengubah otomasi rekrutmen (auto-reply, reminder, eskalasi SLA, retensi) dan preferensi notifikasi pribadi" },
  ],

  // Recruitment F8 — analytics & prediktif (dashboard, metrik, adverse-impact,
  // proyeksi, tampilan tersimpan + export)
  "recruitment:reports": [
    { key: "export", label: "Mengekspor laporan", hint: "Mengunduh CSV dashboard/metrik/adverse-impact rekrutmen" },
    { key: "views", label: "Mengelola tampilan tersimpan", hint: "Menyimpan/menghapus/jadwal tampilan laporan pribadi (ringkasan email mingguan)" },
  ],

  // Recruitment F9 — kepatuhan UU PDP (DSR, consent, retensi, audit PII)
  "recruitment:compliance": [
    { key: "handle", label: "Menangani DSR & consent", hint: "Membuat/memproses permintaan subjek data (akses/ekspor/hapus) dan menarik consent pelamar" },
    { key: "retention", label: "Menjalankan retensi data", hint: "Menjalankan siklus anonimisasi retensi dan mengubah pengaturan retensi (bulan per status, dry-run)" },
    { key: "export", label: "Mengunduh paket data & audit PII", hint: "Mengunduh paket data pelamar (DSR ekspor) dan log akses data pribadi (CSV)" },
  ],

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

  // Settings — eSign (Task 80d): kelola kunci & PIN tanda tangan elektronik
  "settings:esign": [
    { key: "reset-pin", label: "Mereset PIN tanda tangan pengguna", hint: "Menghapus PIN eSign pengguna — kembali ke faktor OTP email" },
    { key: "revoke", label: "Mencabut kunci tanda tangan", hint: "Mencabut kunci RSA pengguna — ttd lama tetap sah, ttd baru tertahan sampai kunci dibuat ulang" },
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

  // Task 96 — AI: mengubah provider AI tenant & mengelola basis pengetahuan
  "settings:ai-provider": [
    { key: "test", label: "Menguji koneksi provider AI", hint: "Tombol Tes Koneksi pada Provider AI (Pengaturan)" },
  ],
  "settings:ai-knowledge": [],

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
