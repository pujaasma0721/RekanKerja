// P0-PERF — data default modul Performance (DEVELOPMENT-PLAN-PERFORMANCE.md
// §20 P0; Lampiran B pustaka KPI starter-pack, §4.4/Lampiran C skala rating).
// SATU sumber kebenaran untuk seed — dipakai oleh:
//   1. scripts/migrate-performance-p0.ts (tenant existing, via parity-runner)
//   2. src/rekankerja/shared/lib/provisioning.ts ensurePerformanceReference
//      (tenant baru; pola duplikasi sengaja F0-REC dihindari lewat modul ini).

export const PERF_YEAR = new Date().getFullYear();

export type KpiSeed = {
  code: string; name: string; category: string; polarity: string; unit: string;
  dataSource?: string; sourceKey?: string; description?: string;
};

/** Pustaka KPI starter-pack — 40 KPI, 4 perspektif BSC (Lampiran B). */
export const KPI_SEED: KpiSeed[] = [
  // Financial (10)
  { code: "FIN-PIUTANG-TERTAGIH", name: "Nilai piutang tertagih", category: "Financial", polarity: "Higher", unit: "Rp", description: "Nilai rupiah piutang yang berhasil ditagih dalam periode" },
  { code: "FIN-BIAYA-VS-ANGGARAN", name: "Biaya operasional vs anggaran", category: "Financial", polarity: "Lower", unit: "%", description: "Deviasi biaya operasional terhadap anggaran" },
  { code: "FIN-SELISIH-STOK", name: "Selisih stok fisik vs sistem", category: "Financial", polarity: "Lower", unit: "%", description: "Selisih opname stok fisik terhadap catatan sistem" },
  { code: "FIN-PENGHEMATAN", name: "Penghematan pengadaan", category: "Financial", polarity: "Higher", unit: "Rp", description: "Nilai penghematan hasil negosiasi/efisiensi pengadaan" },
  { code: "FIN-KEPATUHAN-ANGGARAN", name: "Kepatuhan anggaran unit", category: "Financial", polarity: "Higher", unit: "%", description: "Realisasi dalam batas anggaran yang disetujui" },
  { code: "FIN-POSTING-JURNAL", name: "Ketepatan posting jurnal", category: "Financial", polarity: "Higher", unit: "%", description: "Jurnal terposting akurat tanpa koreksi" },
  { code: "FIN-REKONSILIASI-BANK", name: "Rekonsiliasi bank tepat waktu", category: "Financial", polarity: "Higher", unit: "%", description: "Rekonsiliasi selesai sesuai jadwal tutup buku" },
  { code: "FIN-UMUR-PIUTANG", name: "Piutang tertunda >60 hari", category: "Financial", polarity: "Lower", unit: "Rp", description: "Nilai piutang yang melewati umur 60 hari" },
  { code: "FIN-PELAPORAN-PAJAK", name: "Ketepatan pelaporan pajak", category: "Financial", polarity: "Higher", unit: "%", description: "Pelaporan pajak tepat waktu tanpa koreksi" },
  { code: "FIN-ROI-PROYEK", name: "ROI proyek unit", category: "Financial", polarity: "Higher", unit: "%", description: "Imbal hasil proyek/program yang dikelola" },
  // Customer (10)
  { code: "CUS-KEPUASAN-INTERNAL", name: "Kepuasan pelanggan internal", category: "Customer", polarity: "Higher", unit: "skala", description: "Skor survei kepuasan unit pengguna internal" },
  { code: "CUS-KEPUASAN-EKSTERNAL", name: "Kepuasan pelanggan eksternal (survei)", category: "Customer", polarity: "Higher", unit: "skala", description: "Skor survei/CSAT pelanggan eksternal" },
  { code: "CUS-SLA-TIKET", name: "SLA penyelesaian tiket", category: "Customer", polarity: "Higher", unit: "%", description: "Tiket terselesaikan dalam SLA" },
  { code: "CUS-KELUHAN-BERULANG", name: "Keluhan berulang", category: "Customer", polarity: "Lower", unit: "kasus", description: "Keluhan pelanggan yang berulang pada periode" },
  { code: "CUS-KETEPATAN-KIRIM-DOK", name: "Ketepatan pengiriman dokumen", category: "Customer", polarity: "Higher", unit: "%", description: "Dokumen terkirim sesuai tenggat" },
  { code: "CUS-WAKTU-RESPONS", name: "Waktu respons keluhan pelanggan", category: "Customer", polarity: "Lower", unit: "jam", description: "Rata-rata jam respons pertama keluhan" },
  { code: "CUS-RETENSI-KLIEN", name: "Retensi klien utama", category: "Customer", polarity: "Higher", unit: "%", description: "Klien utama yang bertahan di periode" },
  { code: "CUS-NPS", name: "Net Promoter Score", category: "Customer", polarity: "Higher", unit: "skala", description: "NPS dari survei rekomendasi" },
  { code: "CUS-KLAIM-TUNTAS", name: "Penyelesaian klaim tepat waktu", category: "Customer", polarity: "Higher", unit: "%", description: "Klaim pelanggan tuntas sesuai tenggat" },
  { code: "CUS-AKURASI-ORDER", name: "Akurasi pemrosesan order", category: "Customer", polarity: "Higher", unit: "%", description: "Order terproses tanpa kesalahan" },
  // InternalProcess (10) — termasuk 6 binding auto-source §16
  { code: "IP-CLOSING-PAYROLL", name: "Ketepatan closing payroll", category: "InternalProcess", polarity: "Higher", unit: "%", description: "Tahapan closing payroll selesai sesuai kalender" },
  { code: "IP-AKURASI-DATA-KARYAWAN", name: "Akurasi data karyawan", category: "InternalProcess", polarity: "Higher", unit: "%", description: "Data kepegawaian akurat tanpa temuan audit" },
  { code: "IP-TIME-TO-FILL", name: "Waktu proses PR → hire", category: "InternalProcess", polarity: "Lower", unit: "hari", dataSource: "Recruitment", sourceKey: "recruitment_time_to_fill", description: "AUTO — rata-rata hari dari PR disetujui sampai hire (officer rekrutmen)" },
  { code: "IP-KEHADIRAN", name: "Persentase kehadiran", category: "InternalProcess", polarity: "Higher", unit: "%", dataSource: "Attendance", sourceKey: "attendance_presence_pct", description: "AUTO — hari hadir ÷ hari kerja terjadwal ×100 (dari modul Attendance)" },
  { code: "IP-TELAT", name: "Akumulasi menit keterlambatan", category: "InternalProcess", polarity: "Lower", unit: "menit", dataSource: "Attendance", sourceKey: "attendance_late_minutes", description: "AUTO — total menit telat dalam periode (dari modul Attendance)" },
  { code: "IP-LEMBUR-VERIFIED", name: "Jam lembur terverifikasi", category: "InternalProcess", polarity: "Higher", unit: "jam", dataSource: "Payroll", sourceKey: "overtime_verified_hours", description: "AUTO — jam lembur status Paid/verified" },
  { code: "IP-LAPORAN-TEPAT", name: "Ketepatan pengiriman laporan rutin", category: "InternalProcess", polarity: "Higher", unit: "%", description: "Laporan rutin terkirim sebelum tenggat" },
  { code: "IP-FULFILLED-H", name: "Pemenuhan MPP rekrutmen", category: "InternalProcess", polarity: "Higher", unit: "%", dataSource: "Recruitment", sourceKey: "recruitment_fulfilled_h", description: "AUTO — Σ fulfilled ÷ Σ headcount rencana ×100 (HR/rekruter)" },
  { code: "IP-ERROR-INPUT", name: "Tingkat error input data", category: "InternalProcess", polarity: "Lower", unit: "kasus", description: "Kesalahan input yang terdeteksi per periode" },
  { code: "IP-PROSES-SURAT", name: "Waktu proses surat ≤ 2 hari", category: "InternalProcess", polarity: "Higher", unit: "%", description: "Surat selesai diproses ≤2 hari kerja" },
  // LearningGrowth (10)
  { code: "LG-PELATIHAN-WAJIB", name: "Penyelesaian pelatihan wajib", category: "LearningGrowth", polarity: "Higher", unit: "%", description: "Pelatihan wajib terselesaikan dari yang dijadwalkan" },
  { code: "LG-INISIATIF-ADOPTED", name: "Inisiatif perbaikan diadopsi", category: "LearningGrowth", polarity: "Higher", unit: "usulan", description: "Usulan perbaikan yang diadopsi implementasinya" },
  { code: "LG-CROSS-TRAINING", name: "Cross-training penguasaan proses", category: "LearningGrowth", polarity: "Higher", unit: "proses", description: "Jumlah proses lain yang dikuasai (multipel)" },
  { code: "LG-ABSEN-TAK-TERENCANA", name: "Absen tak terencana", category: "LearningGrowth", polarity: "Lower", unit: "hari", dataSource: "Leave", sourceKey: "leave_unplanned_days", description: "AUTO — hari cuti non-rencana (dari modul Leave)" },
  { code: "LG-SERTIFIKASI-BARU", name: "Sertifikasi/kualifikasi baru diperoleh", category: "LearningGrowth", polarity: "Higher", unit: "unit", description: "Sertifikasi kompetensi baru dalam periode" },
  { code: "LG-KNOWLEDGE-SHARING", name: "Sesi knowledge sharing", category: "LearningGrowth", polarity: "Higher", unit: "sesi", description: "Sesi berbagi ilmu yang diikuti/dibawakan" },
  { code: "LG-ENGAGEMENT", name: "Partisipasi & skor engagement", category: "LearningGrowth", polarity: "Higher", unit: "%", description: "Partisipasi survei & skor engagement unit" },
  { code: "LG-IDP-PROGRESS", name: "Progres rencana pengembangan individu", category: "LearningGrowth", polarity: "Higher", unit: "%", description: "Capaian rencana pengembangan individu (IDP)" },
  { code: "LG-MENTORING", name: "Sesi mentoring/coaching bawahan", category: "LearningGrowth", polarity: "Higher", unit: "sesi", description: "Sesi pembinaan terhadap bawahan (untuk atasan)" },
  { code: "LG-PROYEK-PERBAIKAN", name: "Proyek perbaikan selesai (kaizen)", category: "LearningGrowth", polarity: "Higher", unit: "proyek", description: "Proyek perbaikan yang diselesaikan" },
];

export const COMPETENCY_LEVEL_LABELS = ["Belum Memenuhi", "Perlu Pengembangan", "Memenuhi Ekspektasi", "Di Atas Ekspektasi", "Menjadi Rujukan"];
/** Padanan EN — pasangan sumber R4 (render t(ID[i], EN[i])). */
export const COMPETENCY_LEVEL_LABELS_EN = ["Does Not Meet", "Needs Development", "Meets Expectations", "Exceeds Expectations", "Role Model"];

export type CompSeed = { code: string; name: string; kind: string; d: { 1: string; 2: string; 3: string; 4: string; 5: string } };

/** Deskriptor level sebagai array (dari properti objek — konten data ID, konvensi letter-defaults). */
export function compLevelDescriptors(cp: CompSeed): string[] {
  return [cp.d[1], cp.d[2], cp.d[3], cp.d[4], cp.d[5]];
}

/** Kompetensi 12 ber-deskriptor 5 level (4 nilai inti + 4 manajerial + 4 teknis — §25-1b). */
export const COMP_SEED: CompSeed[] = [
  { code: "CV-INTEGRITAS", name: "Integritas", kind: "CoreValue", d: {
      1: "Sering terindikasi tidak jujur dalam pencatatan/laporan; data perlu diverifikasi ulang",
      2: "Umumnya jujur namun pernah terjadi penyimpangan kecil tanpa niat merugikan",
      3: "Jujur dan taat pada prosedur; laporan dapat dipercaya",
      4: "Konsisten jujur bahkan di bawah tekanan; menjadi contoh kepatuhan",
      5: "Teladan integritas lintas unit; dipercaya menangani hal sensitif",
    } },
  { code: "CV-DISIPLIN", name: "Disiplin & Kehadiran", kind: "CoreValue", d: {
      1: "Sering terlambat/mangkir tanpa keterangan; mengabaikan aturan kerja",
      2: "Kadang terlambat; kehadiran masih perlu pengingat",
      3: "Hadir tepat waktu dan mematuhi jam kerja secara konsisten",
      4: "Disiplin tinggi; mengelola waktu dan tenggat dengan andal",
      5: "Disiplin menular — menaikkan standar tim; nol pelanggaran",
    } },
  { code: "CV-PEDULI", name: "Peduli & Orientasi Pelayanan", kind: "CoreValue", d: {
      1: "Mengabaikan kebutuhan rekan/pelanggan; respons negatif",
      2: "Melayani bila diminta; kurang proaktif menangkap kebutuhan",
      3: "Melayani internal/eksternal dengan sopan dan tepat waktu",
      4: "Antisipatif terhadap kebutuhan; menindaklanjuti sampai tuntas",
      5: "Membangun loyalitas pelanggan/rekan; pelayanan menjadi standar",
    } },
  { code: "CV-KOLABORASI", name: "Kolaborasi Lintas Tim", kind: "CoreValue", d: {
      1: "Sulit bekerja dengan orang lain; sering konflik",
      2: "Bekerja sama bila difasilitasi; cenderung silo",
      3: "Bekerja sama aktif dalam tim dan lintas fungsi",
      4: "Membangun jembatan antar-tim; menyumbang di luar perannya",
      5: "Penghubung alami lintas unit; dipercaya memimpin kolaborasi",
    } },
  { code: "MG-KOMUNIKASI", name: "Komunikasi Efektif", kind: "Managerial", d: {
      1: "Pesan sering salah tafsir; tidak menyampaikan informasi penting",
      2: "Komunikasi cukup jelas untuk hal rutin; perlu perbaikan struktur",
      3: "Menyampaikan gagasan dengan jelas lisan/tulisan; mendengarkan aktif",
      4: "Menyesuaikan gaya komunikasi dengan audiens; persuasif",
      5: "Komunikator yang dipercaya; memfasilitasi diskusi sulit dengan baik",
    } },
  { code: "MG-KEPEMIMPINAN", name: "Kepemimpinan", kind: "Managerial", d: {
      1: "Tidak mampu mengarahkan; tim tanpa arah",
      2: "Memimpin secara minimal; delegasi belum efektif",
      3: "Mengarahkan tim menuju target; menegakkan kesepakatan",
      4: "Menginspirasi dan mengembangkan tim; mengelola konflik dengan adil",
      5: "Pemimpin panutan; membangun pemimpin baru di dalam tim",
    } },
  { code: "MG-KEPUTUSAN", name: "Pengambilan Keputusan", kind: "Managerial", d: {
      1: "Menunda/escalate semua keputusan; tidak berpijak data",
      2: "Memutuskan untuk hal mudah; analisis dangkal untuk yang kompleks",
      3: "Memutuskan tepat waktu berbasis data yang cukup",
      4: "Menimbang risiko-manfaat dengan matang; keputusan berkualitas tinggi",
      5: "Keputusan strategis berdampak lintas unit; dipercaya pada kondisi ambigu",
    } },
  { code: "MG-PENGEMBANGAN-TIM", name: "Pengembangan Tim", kind: "Managerial", d: {
      1: "Tidak memperhatikan perkembangan bawahan",
      2: "Memberi arahan teknis saja; belum mengembangkan",
      3: "Memberi umpan balik rutin dan kesempatan belajar",
      4: "Menyusun rencana pengembangan per bawahan; memantau progres",
      5: "Mencetak penerus; bawahannya naik jabatan/kompetensi",
    } },
  { code: "TC-ANALITIS", name: "Analitis & Ketelitian", kind: "Technical", d: {
      1: "Kesalahan hitung/catatan sering terjadi",
      2: "Cukup teliti untuk pekerjaan rutin dengan supervisi",
      3: "Akurat dan menelusuri penyebab masalah dengan data",
      4: "Analisis tajam; menemukan pola/akar masalah tersembunyi",
      5: "Ketelitian/analisisnya menjadi rujukan audit standar",
    } },
  { code: "TC-INISIATIF-HASIL", name: "Inisiatif & Orientasi Hasil", kind: "Technical", d: {
      1: "Menunggu perintah; target sering terlewat",
      2: "Mengerjakan yang ditugaskan; sesekali proaktif",
      3: "Menyelesaikan pekerjaan tepat waktu dengan inisiatif cukup",
      4: "Mencari perbaikan cara kerja; melebihi target",
      5: "Motor penggerak pencapaian tim; inisiatif berdampak perusahaan",
    } },
  { code: "TC-ADAPTABILITAS", name: "Adaptabilitas & Pembelajaran", kind: "Technical", d: {
      1: "Menolak perubahan; ketinggalan kompetensi",
      2: "Mengikuti perubahan setelah diyakinkan",
      3: "Menyesuaikan diri dengan perubahan proses/alat kerja",
      4: "Cepat menguasai hal baru; membantu orang lain beradaptasi",
      5: "Agen perubahan; menginisiasi adopsi cara/teknologi baru",
    } },
  { code: "TC-FUNGSIONAL", name: "Penguasaan Teknis Fungsional", kind: "Technical", d: {
      1: "Belum menguasai dasar pekerjaan; butuh pendampingan penuh",
      2: "Menguasai tugas rutin dengan bantuan sesekali",
      3: "Menguasai seluruh proses kerja posisinya secara mandiri",
      4: "Ahli di bidangnya; menjadi rujukan pertanyaan teknis",
      5: "Otoritas fungsional lintas unit; menyusun standar/best practice",
    } },
];

/** Skala rating default 5 tingkat (§4.4 / Lampiran C). */
export const SCALE_SEED: { value: number; labelId: string; labelEn: string; minScore: number; color: string; guideline: string }[] = [
  { value: 5, labelId: "Sangat Baik", labelEn: "Outstanding", minScore: 90, color: "emerald", guideline: "Melebihi hampir seluruh target; perilaku menjadi rujukan lintas tim" },
  { value: 4, labelId: "Baik", labelEn: "Exceeds", minScore: 80, color: "teal", guideline: "Melebihi sebagian target; perilaku di atas ekspektasi" },
  { value: 3, labelId: "Cukup", labelEn: "Meets", minScore: 70, color: "lime", guideline: "Memenuhi target inti; perilaku sesuai deskriptor level jabatan" },
  { value: 2, labelId: "Kurang", labelEn: "Below", minScore: 60, color: "amber", guideline: "Sebagian target tak tercapai; perlu rencana perbaikan" },
  { value: 1, labelId: "Sangat Kurang", labelEn: "Needs Improvement", minScore: 0, color: "rose", guideline: "Mayoritas target gagal atau kritis gagal — pertimbangkan PIP" },
];

/** Template bobot per kelompok jabatan (D5: staff 70/20/10, manajer 60/30/10). */
export const TEMPLATE_SEED: { code: string; name: string; weightsJson: string; compItems: { code: string; weight: number }[] }[] = [
  {
    code: "STAFF-STD", name: "Staff Standar", weightsJson: JSON.stringify({ kpi: 70, competency: 20, core: 10 }),
    compItems: [
      { code: "MG-KOMUNIKASI", weight: 40 },
      { code: "TC-ANALITIS", weight: 30 },
      { code: "TC-INISIATIF-HASIL", weight: 30 },
    ],
  },
  {
    code: "MGR-STD", name: "Manajer Standar", weightsJson: JSON.stringify({ kpi: 60, competency: 30, core: 10 }),
    compItems: [
      { code: "MG-KEPEMIMPINAN", weight: 40 },
      { code: "MG-KOMUNIKASI", weight: 30 },
      { code: "MG-PENGEMBANGAN-TIM", weight: 30 },
    ],
  },
];

/** Nilai inti dinilai rata di semua template (komponen core 10%). */
/** Kode kompetensi nilai inti (dinilai rata di semua template — komponen core 10%). */
export const CORE_TEMPLATE_ITEMS = COMP_SEED.filter((c) => c.kind === "CoreValue").map((c) => c.code);

/** Matriks merit default (rating → bulan bonus & % kenaikan — Alur 8 + estimator §18.12). */
export const MERIT_SEED = {
  code: "MM-STD",
  name: "Matriks Merit Standar",
  gridJson: JSON.stringify({
    5: { bonusMonths: 2, raisePct: [8, 12] },
    4: { bonusMonths: 1.5, raisePct: [6, 8] },
    3: { bonusMonths: 1, raisePct: [4, 6] },
    2: { bonusMonths: 0.5, raisePct: [0, 2] },
    1: { bonusMonths: 0, raisePct: [0, 0] },
    note: "Default — sesuaikan kebijakan per tenant (dipakai Alur 8 & estimator §18.12).",
  }),
};


