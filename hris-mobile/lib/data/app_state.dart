import 'package:flutter/material.dart';

import 'models.dart';
import 'mock_data.dart';

/// State global aplikasi (ChangeNotifier).
/// Data awal = seed demo; seluruh aksi (clock-in, pengajuan, dst)
/// bermutasi state ini agar UI interaktif penuh. Lapisan service
/// OneVity yang sesungguhnya dapat ditancapkan menggantikan seed.
class AppState extends ChangeNotifier {
  final Employee employee = demoEmployee;

  bool loggedIn = false;
  bool privacyMode = false;
  ThemeMode themeMode = ThemeMode.system;

  late List<AttendanceRecord> attendance;
  List<LeaveBalance> leaveBalances = seedLeaveBalances();
  List<LeaveRequest> leaves = [];
  List<Payslip> payslips = seedPayslips();
  List<Claim> claims = [];
  List<MyRequest> requests = [];
  List<LetterRequest> letters = [];
  List<Announcement> announcements = [];
  List<AssetItem> assets = [];
  List<WhistleblowReport> whistleblows = [];
  List<SwapOffer> swaps = [];
  List<AppNotification> notifications = [];
  List<ShiftSchedule> schedule = [];

  int _idSeq = 100;
  String _nextId(String prefix) => '$prefix-${_idSeq++}';

  AppState() {
    final now = DateTime.now();
    attendance = seedAttendance(now);
    leaves = seedLeaves(now);
    claims = seedClaims(now);
    requests = seedRequests(now);
    letters = seedLetters(now);
    announcements = seedAnnouncements(now);
    assets = seedAssets(now);
    whistleblows = seedWhistleblows(now);
    swaps = seedSwaps(now);
    notifications = seedNotifications(now);
    schedule = seedSchedule(now);
  }

  // ---------- auth ----------
  void login() {
    loggedIn = true;
    notifyListeners();
  }

  void logout() {
    loggedIn = false;
    notifyListeners();
  }

  // ---------- preferensi ----------
  void togglePrivacy() {
    privacyMode = !privacyMode;
    notifyListeners();
  }

  void setThemeMode(ThemeMode mode) {
    themeMode = mode;
    notifyListeners();
  }

  // ---------- presensi ----------
  AttendanceRecord? recordToday() {
    final today = DateTime.now();
    for (final r in attendance) {
      if (r.date.year == today.year && r.date.month == today.month && r.date.day == today.day) {
        return r;
      }
    }
    return null;
  }

  bool get isClockedIn => recordToday()?.checkIn != null;
  bool get isClockedOut => recordToday()?.checkOut != null;

  void clockIn() {
    if (isClockedIn) return;
    final now = DateTime.now();
    final late = now.hour > 8 || (now.hour == 8 && now.minute > 5);
    attendance.add(AttendanceRecord(
      DateTime(now.year, now.month, now.day),
      TimeOfDay.fromDateTime(now),
      null,
      late ? AttendanceStatus.late : AttendanceStatus.present,
      location: 'Kantor Pusat Jakarta',
    ));
    _notifyUser(
      late ? 'Kamu tercatat terlambat' : 'Clock-in berhasil — semangat harimu! 💪',
      'Presensi tercatat ${_jam(now)} di Kantor Pusat Jakarta.',
      'attendance',
    );
    notifyListeners();
  }

  void clockOut() {
    final today = DateTime.now();
    for (final r in attendance) {
      if (r.date.year == today.year && r.date.month == today.month && r.date.day == today.day && r.checkOut == null) {
        final now = TimeOfDay.fromDateTime(DateTime.now());
        final worked = _worked(r.checkIn!, now);
        attendance[attendance.indexOf(r)] = AttendanceRecord(
          r.date, r.checkIn, now, r.status,
          overtimeMinutes: worked > 540 ? ((worked - 540) ~/ 15) * 15 : 0,
          location: r.location,
        );
        _notifyUser('Clock-out tercatat', 'Kerja hari ini ${_fmtDur(worked)}. Terima kasih, sampai besok! 👋', 'attendance');
        break;
      }
    }
    notifyListeners();
  }

  int _worked(TimeOfDay a, TimeOfDay b) => b.hour * 60 + b.minute - (a.hour * 60 + a.minute);
  String _fmtDur(int m) => m < 600 ? '$m menit' : '${(m / 60).toStringAsFixed(1)} jam';
  String _jam(DateTime d) => '${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}';

  /// Statistik bulan aktif.
  ({int hadir, int terlambat, int absen, int cuti, int lemburMenit, int totalMenit}) monthStats(DateTime month) {
    int hadir = 0, terlambat = 0, absen = 0, cuti = 0, lembur = 0, total = 0;
    for (final r in attendance) {
      if (r.date.year != month.year || r.date.month != month.month) continue;
      switch (r.status) {
        case AttendanceStatus.present:
          hadir++;
        case AttendanceStatus.late:
          terlambat++;
        case AttendanceStatus.absent:
          absen++;
        case AttendanceStatus.leave:
          cuti++;
        default:
          break;
      }
      lembur += r.overtimeMinutes;
      if (r.checkIn != null && r.checkOut != null) {
        total += _worked(r.checkIn!, r.checkOut!);
      }
    }
    return (hadir: hadir, terlambat: terlambat, absen: absen, cuti: cuti, lemburMenit: lembur, totalMenit: total);
  }

  // ---------- cuti ----------
  void submitLeave({required String type, required DateTimeRange range, required String reason}) {
    final days = range.end.difference(range.start).inDays + 1;
    leaves.insert(
      0,
      LeaveRequest(
        id: _nextId('LV'),
        type: type,
        from: range.start,
        to: range.end,
        days: days,
        reason: reason,
        status: 'submitted',
        submittedAt: DateTime.now(),
        steps: [
          ApprovalStep('Atasan Langsung', employee.manager, 'pending'),
          ApprovalStep('HR', 'Sari Wulandari', 'pending'),
        ],
      ),
    );
    for (final b in leaveBalances) {
      if (b.type == type) {
        final i = leaveBalances.indexOf(b);
        leaveBalances[i] = LeaveBalance(b.type, b.entitled, b.used + days);
        break;
      }
    }
    _notifyUser('Pengajuan cuti terkirim ✈️', '$type $days hari — menunggu persetujuan atasan.', 'leave');
    notifyListeners();
  }

  // ---------- klaim ----------
  void submitClaim({required String type, required String provider, required int amount, required String desc}) {
    claims.insert(
      0,
      Claim(
        _nextId('CL'), type, provider, desc, DateTime.now(), amount, 'submitted',
        [
          ApprovalStep('Atasan Langsung', employee.manager, 'pending'),
          ApprovalStep('HR — Klaim', 'Sari Wulandari', 'pending'),
        ],
      ),
    );
    _notifyUser('Klaim dikirim', 'Klaim $type sedang diproses. Pantau statusnya di menu Klaim.', 'claim');
    notifyListeners();
  }

  // ---------- lembur / workoff / travel ----------
  void submitOvertime({required DateTime date, required TimeOfDay start, required TimeOfDay end, required String reason}) {
    final hours = ((end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)) / 60.0;
    requests.insert(
      0,
      MyRequest(
        _nextId('OT'), RequestKind.overtime, date, 'Lembur — $reason',
        '${_fmtT(start)} – ${_fmtT(end)} · ${hours.toStringAsFixed(1)} jam', 'submitted', DateTime.now(),
      ),
    );
    _notifyUser('Pengajuan lembur terkirim', 'Menunggu persetujuan atasan.', 'request');
    notifyListeners();
  }

  void submitWorkoff({required DateTime date, required String reason}) {
    requests.insert(
      0,
      MyRequest(_nextId('WO'), RequestKind.workoff, date, 'Workoff', reason, 'submitted', DateTime.now()),
    );
    _notifyUser('Pengajuan workoff terkirim', 'Menunggu persetujuan atasan.', 'request');
    notifyListeners();
  }

  void submitTravel({required DateTimeRange range, required String destination, required String purpose}) {
    final days = range.end.difference(range.start).inDays + 1;
    requests.insert(
      0,
      MyRequest(
        _nextId('TR'), RequestKind.travel, range.start, 'Dinas ke $destination',
        '$days hari · $purpose · Uang muka diajukan', 'submitted', DateTime.now(),
      ),
    );
    _notifyUser('Pengajuan perjalanan dinas terkirim', 'Menunggu persetujuan atasan & finance.', 'request');
    notifyListeners();
  }

  void submitSwap({required DateTime myDate, required String colleague, required DateTime colleagueDate, required String reason}) {
    swaps.insert(
      0,
      SwapOffer(_nextId('SW'), myDate, 'Reguler 08.00–17.00', colleague, colleagueDate, 'Shift 2 13.00–22.00', 'submitted'),
    );
    _notifyUser('Tawaran tukar shift dikirim', 'Menunggu respons $colleague.', 'swap');
    notifyListeners();
  }

  void submitLetter({required String type, required String purpose}) {
    letters.insert(0, LetterRequest(_nextId('LT'), type, purpose, 'submitted', DateTime.now()));
    _notifyUser('Permintaan surat terkirim', 'Surat $type sedang diproses HR (±2 hari kerja).', 'letter');
    notifyListeners();
  }

  void submitWhistleblow({required String category, required String description, required bool anonymous}) {
    final ticket = 'WB-2026-${(50 + whistleblows.length + 1).toString().padLeft(4, '0')}';
    whistleblows.insert(0, WhistleblowReport(_nextId('WB'), ticket, category, description, DateTime.now(), 'submitted'));
    _notifyUser('Laporan diterima — terima kasih berani bicara 🛡️',
        'Kode pelacakan: $ticket. Identitas ${anonymous ? "tidak" : "tercatat"} dilampirkan sesuai pilihanmu.', 'whistleblow');
    notifyListeners();
  }

  // ---------- notifikasi ----------
  void _notifyUser(String title, String body, String kind) {
    notifications.insert(0, AppNotification(_nextId('NT'), title, body, DateTime.now(), kind, false));
  }

  int get unreadCount => notifications.where((n) => !n.read).length;

  void markRead(AppNotification n) {
    n.read = true;
    notifyListeners();
  }

  void markAllRead() {
    for (final n in notifications) {
      n.read = true;
    }
    notifyListeners();
  }

  String _fmtT(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}.${t.minute.toString().padLeft(2, '0')}';
}
