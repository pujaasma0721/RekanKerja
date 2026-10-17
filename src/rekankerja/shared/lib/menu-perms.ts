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
  // P1.1-BM — pengajuan ubah data diri ESS: memutuskan (patch otomatis saat
  // approve akhir — before/after ter-audit ActivityLog).
  "hr:profile-changes": [{ key: "approve", label: "Menyetujui / menolak pengajuan ubah data", hint: "Memutuskan pengajuan perubahan data diri karyawan dari ESS" }],

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
  // P1.4-BM (D-BM11) — ekspor jurnal ke format akuntansi (Accurate/Jurnal/generik)
  "payroll:journals": [{ key: "export", label: "Mengekspor jurnal", hint: "Mengunduh jurnal payroll (CSV/GL akuntansi)" }],

  // Attendance — persetujuan kehadiran
  "attendance:overtime": [{ key: "approve", label: "Menyetujui / menolak lembur", hint: "Memutuskan pengajuan lembur (overtime)" }],
  "attendance:workoff": [{ key: "approve", label: "Menyetujui / menolak work off", hint: "Memutuskan izin work off" }],
  "attendance:assignment-schedule": [{ key: "end", label: "Mengakhiri penugasan jadwal", hint: "Mengakhiri assign jadwal karyawan" }],
  // P1.3-BM — regularisasi absensi mandiri: memutuskan pengajuan karyawan
  "attendance:regularization": [{ key: "approve", label: "Menyetujui / menolak regularisasi", hint: "Memutuskan pengajuan regularisasi absensi (lupa absen / jam salah)" }],
  // P1.5-BM (D-BM12) — impor dataset kalender libur nasional (SKB) + CSV
  "attendance:holidays": [{ key: "import", label: "Mengimpor kalender libur", hint: "Impor dataset SKB 3 Menteri & impor massal CSV" }],

  // Leave
  "leave:leave-request": [{ key: "cancel", label: "Membatalkan pengajuan cuti", hint: "Membatalkan permintaan cuti (draft/pending)" }],
  "leave:leave-approval": [{ key: "approve", label: "Menyetujui / menolak cuti", hint: "Aksi Setujui & Tolak pada persetujuan cuti" }],
  "leave:leave-encashment": [{ key: "approve", label: "Menyetujui / menolak encashment", hint: "Memutuskan pengajuan uang pengganti cuti" }],

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

  // B8-BL — referral tracker: register referral (view-only) + op catat insentif
  "recruitment:referral": [
    { key: "reward", label: "Mencatat insentif referral (manual)", hint: "Mengubah catatan insentif perujuk — catatan manual DI LUAR payroll (B8 §5)" },
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
  // P0-PERF — modul Performance (DEVELOPMENT-PLAN-PERFORMANCE.md §14.2/§17):
  // ops khusus per menu (base view/create/update/delete sudah bawaan).
  "performance:masters": [
    { key: "version", label: "Membuat versi baru pustaka", hint: "Simpan perubahan definitif KPI/kompetensi sebagai versi baru ber-tahun berlaku (§18.9)" },
    { key: "archive", label: "Mengarsipkan pustaka", hint: "Menonaktifkan KPI/kompetensi dari picker tanpa menghapus riwayat (guard §35-28)" },
  ],
  "performance:settings": [
    { key: "update", label: "Mengubah pengaturan kinerja", hint: "Prefix nomor dokumen (PER/PRB/PIP/MER), bobot default, jendela banding, retensi arsip" },
  ],
  "performance:cycles": [
    { key: "enroll", label: "Mendaftarkan peserta", hint: "Enroll massal karyawan aktif ke siklus penilaian (snapshot atasan)" },
    { key: "phase", label: "Menggerakkan fase siklus", hint: "Membuka/menutup jendela fase (goal/self/manager/kalibrasi) dan publikasi" },
    { key: "nudge", label: "Nudge multi-kanal", hint: "Remind All / kirim WA / email pengingat formulir (AM2 §18.8 — rate-limit)" },
  ],
  // P1-PERF — Target & KPI: penetapan/usulan/lock + impor Excel target (AM2 §18.5)
  "performance:goals": [
    { key: "import", label: "Impor Excel target", hint: "Unggah target KPI massal via template Excel (AM2 §18.5 — hanya baris valid)" },
  ],
  // P2-PERF — Check-in 1-on-1 & revisi mid-year (§27)
  "performance:checkins": [
    { key: "revise", label: "Mengajukan revisi target", hint: "Revisi target mid-year dengan alasan + persetujuan atasan berjenjang (§27-4)" },
  ],
  "performance:appraisals": [
    { key: "finalize", label: "Finalisasi penilaian", hint: "Mengunci nilai & mengirim ke kalibrasi" },
    { key: "ai-compose", label: "AI Assist ulasan", hint: "Menyusun draf ulasan dari poin penilai (AM3 §18.11 — compose-only)" },
    { key: "import", label: "Impor Excel realisasi", hint: "Unggah realisasi akhir tahun massal via template Excel (AM2 §18.5)" },
    { key: "pull", label: "Tarik data otomatis", hint: "Menarik nilai KPI dari modul sumber (kehadiran/lembur/cuti/rekrutmen) dengan bukti (AM2 §18.6)" },
  ],
  "performance:calibration": [
    { key: "decide", label: "Keputusan kalibrasi", hint: "Mengubah skor/rating final dengan alasan ter-audit" },
    { key: "finalize", label: "Finalisasi penilaian", hint: "Mengajukan hasil ke approval PerformanceAppraisal (batch)" },
    { key: "approve", label: "Memutus approval finalisasi", hint: "Menyetujui/menolak dokumen PerformanceAppraisal di kotak finalisasi (jenjang sesuai engine)" },
  ],
  "performance:results": [
    { key: "publish", label: "Publikasi hasil", hint: "Menerbitkan hasil ke karyawan + jendela acknowledgement" },
    { key: "appeal", label: "Memutuskan banding", hint: "Menyetujui/menolak banding karyawan dalam jendela" },
    { key: "close", label: "Menutup hasil siklus", hint: "Menutup hasil siklus menjadi read-only permanen setelah semua banding selesai (§35-16)" },
    // P5-PERF — Merit, PA & Surat (§32 Alur 8)
    { key: "merit", label: "Mengelola usulan merit", hint: "Rekomendasi bonus/kenaikan pasca-penilaian → payroll/PA (§32)" },
    { key: "pip", label: "Memutuskan usul PIP", hint: "Menjalankan atau menolak usulan PIP rating ≤2 (§32-5)" },
  ],

  // P6-PERF — PIP end-to-end (§33 Alur 9): register & checkpoint
  "performance:pip": [
    { key: "activate", label: "Mengaktivasi PIP", hint: "Mengajukan PIP ke approval AS-PIP-STD dan mengaktifkan program (§33-1)" },
    { key: "checkpoint", label: "Review checkpoint PIP", hint: "Mencatat capaian checkpoint 30/60/90 hari oleh pembina (§33-3)" },
    { key: "extend", label: "Memperpanjang PIP", hint: "Perpanjangan 1× dengan total durasi ≤3 bulan (§35-21)" },
    { key: "outcome", label: "Memutuskan hasil PIP", hint: "Keputusan akhir Recovered/NotRecovered (§35-22)" },
  ],

  // P7-PERF — evaluasi masa percobaan (§28 Alur 4; §7.1 UU 13/2003 Ps.60)
  "performance:probation": [
    { key: "assess", label: "Penilaian atasan", hint: "Mengisi skor atasan 0–100 + kriteria bobot 3–6 item Σ100 (§28-2)" },
    { key: "recommend", label: "Rekomendasi HR", hint: "Confirm / Extend (perjanjian kerja baru — UU 13/2003 Ps.60 §7.1) / Terminate (§28-3)" },
    { key: "submit", label: "Mengajukan keputusan", hint: "Meneruskan rekomendasi ke jalur persetujuan AS-PROB-STD (L3 Direktur hanya utk Terminate)" },
    { key: "decide", label: "Keputusan masa percobaan", hint: "Memutus jenjang persetujuan + menggulir PA + menerbitkan surat (§28-4)" },
    { key: "cancel", label: "Membatalkan evaluasi", hint: "Membatalkan evaluasi percobaan (mis. salah karyawan) — alasan ter-audit" },
  ],

  // P9-PERF — kepatuhan UU PDP (§20 P9; §7.3/§37): DSR karyawan (data
  // kinerja) + retensi arsip hasil penilaian + matriks akses §11.3.
  "performance:compliance": [
    { key: "dsr", label: "Mengelola DSR karyawan", hint: "Permintaan subjek data UU PDP: akses/ekspor/hapus data kinerja karyawan (§7.3, §37 — SLA 7 hari)" },
    { key: "retention", label: "Mengelola retensi arsip", hint: "Menjalankan scan retensi & memulihkan data terarsip (tandai-saja — penghapusan manual §37)" },
  ],

  // B1-BL — OKR kuartalan (DEVELOPMENT-PLAN-BACKLOG.md §4 B1; D-BL1…D-BL5):
  // alat transparansi tujuan TERPISAH dari mesin penilaian. Posting ke board
  // org-wide (D-BL3) & penutupan kuartal dgn skor final server (D-BL5) = op
  // khusus; create/update/delete objective Draft + update progres KR ikut
  // aksi CRUD bawaan (owner objective / HR — guard di service).
  "performance:okr": [
    { key: "post", label: "Memosting objective OKR", hint: "Menerbitkan objective Draft ke board transparan yang terlihat seluruh karyawan (D-BL3)" },
    { key: "close", label: "Menutup objective kuartal", hint: "Menutup objective Posted di akhir kuartal — skor final dihitung server (D-BL5, hanya HR)" },
  ],

  // B3-BL/B4-BL — Talent: attrisi heuristik explainable (B3, read-only) +
  // succession planning (B4; D-BL13…D-BL15). Cakupan baris D-BL12 dijaga DI
  // SERVICE (attrisi: HR/Direksi/atasan-langsung; succession: HR/Direksi —
  // mutasi register HR saja). Op B4: kelola register peran & kandidat + ekspor.
  "performance:talent": [
    { key: "position/manage", label: "Mengelola peran kritis succession", hint: "Mendaftarkan/mengubah/menghapus peran kritis & target penerus (D-BL14)" },
    { key: "candidate/manage", label: "Mengelola kandidat penerus", hint: "Menambah/mengubah readiness & catatan pengembangan/menghapus kandidat succession (D-BL13)" },
    { key: "export", label: "Mengekspor rencana suksesi", hint: "Mengunduh laporan XLSX succession dwibahasa (D-BL15)" },
  ],

  // B5-BL — benchmark gaji pasar (D-BL16/D-BL17): master benchmark eksternal
  // manual HR (tahun × sumber × kunci grade/posisi, p25/p50/p75) + kompa-ratio
  // karyawan vs p50. Menu admin-only (ESS tidak melihat benchmark — risiko §5);
  // guard baris HR/Direksi di service. Op: impor XLSX + kelola master + ekspor.
  "payroll:benchmark": [
    { key: "import", label: "Mengimpor benchmark gaji (XLSX)", hint: "Unggah data survei pasar via template Excel — pratinjau per sel, hanya baris valid masuk (D-BL16)" },
    { key: "manage", label: "Mengelola master benchmark", hint: "Menambah/mengubah/menghapus entri benchmark tahun × sumber × kunci grade/posisi (D-BL16)" },
    { key: "export", label: "Mengekspor laporan benchmark", hint: "Mengunduh laporan XLSX kompa-ratio + master benchmark dwibahasa (D-BL17)" },
  ],

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
