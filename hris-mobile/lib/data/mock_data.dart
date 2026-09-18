import 'package:flutter/material.dart';

import 'models.dart';

/// Seed data demo — realistis mengikuti domain OneVity (tenant MII).
/// Semua tanggal relatif terhadap hari ini agar selalu terasa "hidup".

final demoEmployee = Employee(
  id: 'emp-001',
  employeeNo: 'MII00042',
  fullName: 'Raka Prasetyo Wibowo',
  nickname: 'Raka',
  email: 'raka.prasetyo@mii.co.id',
  phone: '+62 812-3456-7890',
  position: 'Senior Frontend Engineer',
  unit: 'Teknologi Informasi',
  office: 'Kantor Pusat Jakarta',
  grade: 'P7 — Senior',
  employmentStatus: 'Tetap (PKWTT)',
  manager: 'Tri Handayani',
  joinDate: DateTime(2022, 3, 14),
  family: [
    FamilyMember('Amelia Rahma', 'Pasangan', DateTime(1994, 8, 21)),
    FamilyMember('Kayla Ayesha P.', 'Anak', DateTime(2021, 12, 2)),
  ],
  documents: [
    EmployeeDoc('KTP — Raka Prasetyo W.', 'Identitas', DateTime(2024, 1, 10)),
    EmployeeDoc('Kartu Keluarga', 'Keluarga', DateTime(2024, 1, 10)),
    EmployeeDoc('Ijazah S1 Informatika', 'Pendidikan', DateTime(2022, 3, 1)),
    EmployeeDoc('NPWP', 'Perpajakan', DateTime(2022, 4, 15)),
  ],
);

List<ShiftSchedule> seedSchedule(DateTime base) {
  final list = <ShiftSchedule>[];
  for (int i = -7; i <= 14; i++) {
    final d = base.add(Duration(days: i));
    if (d.weekday == DateTime.saturday || d.weekday == DateTime.sunday) {
      list.add(ShiftSchedule(d, 'Libur', '—'));
    } else if (i % 9 == 0 && i != 0) {
      list.add(ShiftSchedule(d, 'Shift 2', '13.00 – 22.00'));
    } else {
      list.add(ShiftSchedule(d, 'Reguler', '08.00 – 17.00'));
    }
  }
  return list;
}

/// Presensi 45 hari terakhir: weekday dengan variasi realistis.
List<AttendanceRecord> seedAttendance(DateTime now) {
  final list = <AttendanceRecord>[];
  var seed = now.day * 7 + now.month * 13;
  int rnd() => seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  for (int i = 45; i >= 0; i--) {
    final d = DateTime(now.year, now.month, now.day - i);
    final isWeekend = d.weekday == DateTime.saturday || d.weekday == DateTime.sunday;
    if (isWeekend) {
      list.add(AttendanceRecord(d, null, null, AttendanceStatus.weekend));
      continue;
    }
    final r = rnd() % 100;
    if (r < 6) {
      list.add(AttendanceRecord(d, null, null, AttendanceStatus.absent));
    } else if (r < 14) {
      list.add(AttendanceRecord(d, null, null, AttendanceStatus.leave));
    } else if (r < 28) {
      final inH = 8, inM = 15 + rnd() % 25;
      final outM = 17;
      list.add(AttendanceRecord(
        d,
        TimeOfDay(hour: inH, minute: inM),
        TimeOfDay(hour: outM, minute: 5 + rnd() % 20),
        AttendanceStatus.late,
        overtimeMinutes: rnd() % 100 < 30 ? 60 + (rnd() % 90) : 0,
        location: 'Kantor Pusat Jakarta',
      ));
    } else if (r < 22) {
      list.add(AttendanceRecord(d, null, null, AttendanceStatus.holiday));
    } else {
      final inM = rnd() % 15;
      final outM = 17;
      list.add(AttendanceRecord(
        d,
        TimeOfDay(hour: 7, minute: 45 + inM),
        TimeOfDay(hour: outM, minute: rnd() % 30),
        AttendanceStatus.present,
        overtimeMinutes: rnd() % 100 < 35 ? 60 + (rnd() % 120) : 0,
        location: 'Kantor Pusat Jakarta',
      ));
    }
  }
  // Hari ini: belum clock-out.
  final today = DateTime(now.year, now.month, now.day);
  list.removeWhere((r) => r.date == today);
  return list;
}

List<LeaveBalance> seedLeaveBalances() => [
      LeaveBalance('Cuti Tahunan', 14, 2),
      LeaveBalance('Cuti Besar', 32, 0),
      LeaveBalance('Cuti Melahirkan', 90, 0),
      LeaveBalance('Cuti Sakit', 12, 1),
    ];

List<LeaveRequest> seedLeaves(DateTime now) => [
      LeaveRequest(
        id: 'LV-0912',
        type: 'Cuti Tahunan',
        from: now.subtract(const Duration(days: 6)),
        to: now.subtract(const Duration(days: 6)),
        days: 1,
        reason: 'Acara keluarga',
        status: 'approved',
        submittedAt: now.subtract(const Duration(days: 12)),
        steps: [
          ApprovalStep('Atasan Langsung', 'Tri Handayani', 'approved'),
          ApprovalStep('HR', 'Sari Wulandari', 'approved'),
        ],
      ),
      LeaveRequest(
        id: 'LV-0915',
        type: 'Cuti Sakit',
        from: now.subtract(const Duration(days: 20)),
        to: now.subtract(const Duration(days: 20)),
        days: 1,
        reason: 'Demam — istirahat di rumah',
        status: 'approved',
        submittedAt: now.subtract(const Duration(days: 19)),
        steps: [
          ApprovalStep('Atasan Langsung', 'Tri Handayani', 'approved'),
          ApprovalStep('HR', 'Sari Wulandari', 'approved'),
        ],
      ),
    ];

List<Payslip> seedPayslips() {
  final now = DateTime.now();
  final list = <Payslip>[];
  for (int i = 1; i <= 12; i++) {
    final dt = DateTime(now.year, now.month - i, 1);
    final gajiPokok = 12500000;
    final tunjJabatan = 3200000;
    final tunjKeluarga = 750000;
    final tunjTransport = 700000;
    final tunjMakan = 660000;
    final bpjsJhtP = (gajiPokok * 0.037).round();
    final bpjsJpP = (gajiPokok * 0.02).round();
    final bpjsJkk = (gajiPokok * 0.0024).round();
    final lembur = (i % 3 == 0) ? 985000 : 0;
    final gross = gajiPokok + tunjJabatan + tunjKeluarga + tunjTransport + tunjMakan + bpjsJhtP + bpjsJpP + bpjsJkk + lembur;
    final potJht = (gajiPokok * 0.02).round();
    final potJp = (gajiPokok * 0.01).round();
    final potJpk = (gajiPokok * 0.01).round();
    final pph21 = 1480000 + (i % 4) * 95000;
    final potongan = potJht + potJp + potJpk + pph21;
    list.add(Payslip(
      dt.year,
      dt.month,
      gross - potongan,
      gross,
      pph21,
      [
        PayComponent('Gaji Pokok', gajiPokok),
        PayComponent('Tunjangan Jabatan', tunjJabatan),
        PayComponent('Tunjangan Keluarga', tunjKeluarga, note: 'PTKP K/1'),
        PayComponent('Tunjangan Transport', tunjTransport),
        PayComponent('Tunjangan Makan', tunjMakan),
        PayComponent('BPJS JHT — Perusahaan 3,7%', bpjsJhtP),
        PayComponent('BPJS JP — Perusahaan 2%', bpjsJpP),
        PayComponent('BPJS JKK — Perusahaan', bpjsJkk),
        if (lembur > 0) PayComponent('Upah Lembur', lembur),
        PayComponent('BPJS JHT — 2%', potJht, isDeduction: true),
        PayComponent('BPJS JP — 1%', potJp, isDeduction: true),
        PayComponent('BPJS JKP 1% + JKK/JKM', potJpk, isDeduction: true),
        PayComponent('PPh 21 (TER bulanan)', pph21, isDeduction: true, note: 'Sesuai PMK 168/2023'),
      ],
    ));
  }
  return list;
}

List<Claim> seedClaims(DateTime now) => [
      Claim(
        'CL-2201', 'Rawat Jalan', 'Klinik Sehat Sentosa',
        'Konsultasi dokter umum + obat flu', now.subtract(const Duration(days: 4)), 485000, 'pending',
        [ApprovalStep('Atasan Langsung', 'Tri Handayani', 'approved'), ApprovalStep('HR — Klaim', 'Sari Wulandari', 'pending')],
      ),
      Claim(
        'CL-2187', 'Perawatan Gigi', 'Dental Care Menteng',
        'Scaling + tambal gigi', now.subtract(const Duration(days: 26)), 1250000, 'approved',
        [ApprovalStep('Atasan Langsung', 'Tri Handayani', 'approved'), ApprovalStep('HR — Klaim', 'Sari Wulandari', 'approved')],
      ),
      Claim(
        'CL-2140', 'Kacamata', 'Optik Nusantara',
        'Ganti lensa minus naik 0.5', now.subtract(const Duration(days: 58)), 950000, 'done',
        [ApprovalStep('Atasan Langsung', 'Tri Handayani', 'approved'), ApprovalStep('HR — Klaim', 'Sari Wulandari', 'approved')],
      ),
      Claim(
        'CL-2098', 'Rawat Inap', 'RS Medika Cempaka',
        'Rawat inap 2 hari — demam berdarah', now.subtract(const Duration(days: 95)), 4850000, 'rejected',
        [ApprovalStep('Atasan Langsung', 'Tri Handayani', 'approved'), ApprovalStep('HR — Klaim', 'Sari Wulandari', 'rejected')],
      ),
    ];

List<MyRequest> seedRequests(DateTime now) => [
      MyRequest('OT-3301', RequestKind.overtime, now.subtract(const Duration(days: 1)),
          'Lembur rilis fitur payroll', '17.15 – 21.15 · 4 jam · Konversi ke upah lembur', 'approved', now.subtract(const Duration(days: 1))),
      MyRequest('WO-3300', RequestKind.workoff, now.subtract(const Duration(days: 9)),
          'Workoff lembur akhir pekan', 'Kompensasi 1 hari — sprint Sabtu 6 Sep', 'approved', now.subtract(const Duration(days: 10))),
      MyRequest('TR-3288', RequestKind.travel, now.add(const Duration(days: 7)),
          'Dinas ke Kantor Cabang Surabaya', '16–18 Sep · Keperluan audit TI · Uang muka Rp 3.500.000', 'pending', now.subtract(const Duration(days: 2))),
      MyRequest('OT-3275', RequestKind.overtime, now.subtract(const Duration(days: 15)),
          'Lembur migrasi database', '17.15 – 20.15 · 3 jam', 'approved', now.subtract(const Duration(days: 15))),
      MyRequest('SW-3260', RequestKind.swap, now.subtract(const Duration(days: 21)),
          'Tukar shift dgn Dewi Lestari', 'Shift 2 → Reguler', 'rejected', now.subtract(const Duration(days: 23))),
    ];

List<LetterRequest> seedLetters(DateTime now) => [
      LetterRequest('LT-881', 'Surat Keterangan Kerja',
          'Pengajuan KPR Bank BNI', 'done', now.subtract(const Duration(days: 8))),
      LetterRequest('LT-872', 'Surat Keterangan Gaji',
          'Syarat visa turis Jepang', 'approved', now.subtract(const Duration(days: 31))),
      LetterRequest('LT-859', 'Surat Pengalaman Kerja',
          'Keperluan sertifikasi profesional', 'done', now.subtract(const Duration(days: 74))),
    ];

List<Announcement> seedAnnouncements(DateTime now) => [
      Announcement(
        'AN-101', 'Family Day OneVity — Sabtu depan seru banget!',
        'Bawa keluargamu ke Family Day tahunan di Kantor Pusat! Ada lomba keluarga, food truck, foto corner, dan door prize utama: 1 unit sepeda listrik. Daftar via menu Pengajuan → Event paling lambat Kamis.',
        'Event', 'People & Culture', now.subtract(const Duration(hours: 5)), true,
      ),
      Announcement(
        'AN-100', 'Cut-off payroll September: tanggal 25',
        'Mohon pengajuan lembur, klaim, dan koreksi presensi bulan ini disubmit sebelum tanggal 25 agar terhitung pada run payroll September. Terlambat dari cut-off akan diproses bulan berikutnya.',
        'Payroll', 'Tim Payroll', now.subtract(const Duration(days: 2)), true,
      ),
      Announcement(
        'AN-099', 'Kelas belajar: "AI untuk Produktivitas HR"',
        'Academy OneVity membuka kelas baru! Belajar automation, prompt engineering, dan reporting dengan AI. Kuota 30 orang, prioritas early bird. Link pendaftaran di bio.',
        'Pengembangan', 'OneVity Academy', now.subtract(const Duration(days: 5)), false,
      ),
      Announcement(
        'AN-098', 'Pembaruan kebijakan kerja fleksibel (hybrid)',
        'Mulai Oktober, skema hybrid menjadi 3 hari kantor + 2 hari remote. Detail pengaturan tim dan jadwal koordinasi menyusul dari masing-masing atasan. Kebijakan cuti tidak berubah.',
        'Kebijakan', 'Direksi', now.subtract(const Duration(days: 9)), false,
      ),
      Announcement(
        'AN-097', 'Cek kesehatan tahunan — gratis!',
        'Medical check-up tahunan dibuka untuk semua karyawan. Pilih jadwalmu (Oktober) di menu Pengajuan → Medical Check-up. Peserta mendapat poin Sehat+ yang bisa ditukar voucher gym.',
        'Benefit', 'People & Culture', now.subtract(const Duration(days: 14)), false,
      ),
    ];

List<AssetItem> seedAssets(DateTime now) => [
      AssetItem('AS-01', 'MacBook Pro 14" M3', 'AST-LT-0221', 'C02XK1YZLVDL', 'Elektronik', DateTime(2024, 5, 2), 'Dipinjamkan'),
      AssetItem('AS-02', 'Monitor LG 27" UltraFine', 'AST-MN-0447', '27UP850-AUS', 'Elektronik', DateTime(2024, 5, 2), 'Dipinjamkan'),
      AssetItem('AS-03', 'Keyboard Melepas Keychron K2', 'AST-KB-0189', 'K2-WI-B01', 'Aksesori', DateTime(2023, 11, 20), 'Dipinjamkan'),
      AssetItem('AS-04', 'Kartu Akses Kantor', 'AST-AC-3390', '—', 'Akses', DateTime(2022, 3, 14), 'Aktif'),
      AssetItem('AS-05', 'Jaket Perusahaan 2024', 'AS-ML-1123', '—', 'Merchandise', DateTime(2024, 1, 15), 'Milik karyawan'),
    ];

List<WhistleblowReport> seedWhistleblows(DateTime now) => [
      WhistleblowReport('WB-01', 'WB-2026-0042', 'Benturan Kepentingan',
          'Dugaan kaitan vendor dgn keluarga pejabat pengadaan — detail dikirim via jalur aman.',
          now.subtract(const Duration(days: 18)), 'investigasi'),
      WhistleblowReport('WB-02', 'WB-2026-0031', 'Pelanggaran K3',
          'Alat pemadam di lantai 3 kadaluarsa sejak Februari.', now.subtract(const Duration(days: 46)), 'selesai'),
    ];

List<SwapOffer> seedSwaps(DateTime now) => [
      SwapOffer('SW-01', now.add(const Duration(days: 3)), 'Reguler 08.00–17.00',
          'Dewi Lestari', now.add(const Duration(days: 4)), 'Shift 2 13.00–22.00', 'pending'),
    ];

List<AppNotification> seedNotifications(DateTime now) => [
      AppNotification('NT-1', 'Pengajuan lembur disetujui 🎉',
          'Lembur "rilis fitur payroll" (4 jam) telah disetujui atasan.', now.subtract(const Duration(hours: 2)), 'request', false),
      AppNotification('NT-2', 'Slip gaji periode lalu tersedia',
          'Slip gaji periode Agustus sudah bisa dilihat & diunduh.', now.subtract(const Duration(days: 1)), 'payslip', false),
      AppNotification('NT-3', 'Pengingat: klaim menunggu persetujuan',
          'Klaim Rawat Jalan Rp 485.000 sedang menunggu review HR.', now.subtract(const Duration(days: 2)), 'claim', false),
      AppNotification('NT-4', 'Jadwal tukar shift menunggu',
          'Tawaran tukar shift dgn Dewi Lestari belum direspons.', now.subtract(const Duration(days: 3)), 'swap', true),
      AppNotification('NT-5', 'Selamat! Poin Sehat+ bertambah',
          'Kamu menyelesaikan tantangan langkah 10k hari ini. +50 poin.', now.subtract(const Duration(days: 4)), 'gamification', true),
];
