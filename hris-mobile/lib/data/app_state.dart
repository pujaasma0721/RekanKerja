import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import '../core/format.dart';
import 'mock_data.dart';
import 'models.dart';
import 'onevity_api.dart';

/// Mode sumber data aplikasi.
enum AppMode { demo, live }

/// State global aplikasi (ChangeNotifier).
///
/// DUA MODE:
///  - `demo`  : seluruh data dari seed lokal (mock_data.dart) — aksi
///              bermutasi state lokal, aplikasi tetap interaktif tanpa server.
///  - `live`  : terhubung ke backend OneVity (default
///              https://onevity.sayone.my.id) — data & aksi via REST ESS
///              (`/api/onevity/ess/*`), sesi cookie `onevity_session`.
///
/// Kontrak UI tidak berubah: setiap mutasi mengembalikan `Future<String?>`
/// berisi pesan error (null = sukses) agar halaman bisa menampilkan SnackBar.
class AppState extends ChangeNotifier {
  // ================= infrastruktur live =================
  late final ApiClient apiClient;
  late final OneVityApi api;

  AppMode mode = AppMode.demo;
  bool restoring = true;
  bool busy = false;
  DateTime attMonth = DateTime.now();

  /// Langkah login live yang belum selesai.
  List<Workspace> pendingWorkspaces = [];
  String? pendingMfaToken;

  /// Data agregat live.
  DashboardKpi kpi = const DashboardKpi();
  AttendanceSummary attSummary = const AttendanceSummary();
  List<LetterTemplate> letterTemplates = [];
  SwapMyShift? myShiftInfo;
  List<SwapCandidate> swapCandidates = [];

  /// Data form pengajuan klaim (live): jenis medis + sisa plafon,
  /// serta opsi klaim perjalanan (request/template/jenis biaya).
  List<MedClaimTypeInfo> medicalTypes = [];
  TravelClaimFormData? travelClaimForm;

  /// Nomor dokumen (docNo) klaim terakhir yang berhasil dikirim —
  /// dipakai halaman Klaim untuk SnackBar sukses.
  String? lastClaimDocNo;

  bool get isLive => mode == AppMode.live;
  String get serverHost {
    try {
      return Uri.parse(apiClient.baseUrl).host;
    } catch (_) {
      return apiClient.baseUrl;
    }
  }

  // ================= state data (dipakai UI) =================
  bool loggedIn = false;
  bool privacyMode = false;
  ThemeMode themeMode = ThemeMode.system;

  Employee employee = demoEmployee;
  List<AttendanceRecord> attendance = [];
  List<LeaveBalance> leaveBalances = [];
  List<LeaveRequest> leaves = [];
  List<Payslip> payslips = [];
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
    apiClient = ApiClient();
    api = OneVityApi(apiClient);
    _resetDemo();
    _restoreSession();
  }

  // ================= sesi & restore =================

  Future<SharedPreferences> _prefs() async {
    try {
      return await SharedPreferences.getInstance();
    } catch (_) {
      throw StateError('prefs-unavailable');
    }
  }

  /// Coba lanjutkan sesi live tersimpan (cookie di SharedPreferences).
  Future<void> _restoreSession() async {
    try {
      final prefs = await _prefs();
      final savedUrl = prefs.getString('ov_baseurl');
      if (savedUrl != null && savedUrl.isNotEmpty) apiClient.baseUrl = savedUrl;
      final cookie = prefs.getString('ov_session');
      if (cookie == null || cookie.isEmpty) return;
      apiClient.sessionCookie = cookie;

      final info = await api.sessionInfo();
      if (info.tenant != null) {
        mode = AppMode.live;
        loggedIn = true;
        await refreshAll();
      } else if (info.workspaces.isNotEmpty) {
        pendingWorkspaces = info.workspaces;
      }
    } on ApiException {
      await _clearSavedSession();
    } catch (_) {
      // prefs tak tersedia (mis. environment test) → demo.
    } finally {
      restoring = false;
      notifyListeners();
    }
  }

  Future<void> _clearSavedSession() async {
    apiClient.sessionCookie = null;
    try {
      final prefs = await _prefs();
      await prefs.remove('ov_session');
    } catch (_) {}
  }

  Future<void> _saveSession() async {
    try {
      final prefs = await _prefs();
      if (apiClient.sessionCookie != null) {
        await prefs.setString('ov_session', apiClient.sessionCookie!);
      }
      await prefs.setString('ov_baseurl', apiClient.baseUrl);
    } catch (_) {}
  }

  /// Ganti server tujuan (dialog pengaturan di halaman login).
  Future<void> setServerUrl(String url) async {
    final clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (clean.isEmpty) return;
    apiClient.baseUrl = clean;
    try {
      final prefs = await _prefs();
      await prefs.setString('ov_baseurl', clean);
    } catch (_) {}
    notifyListeners();
  }

  /// Reset URL server ke bawaan (produksi).
  Future<void> resetServerUrl() async {
    apiClient.baseUrl = ApiClient.prodBaseUrl;
    try {
      final prefs = await _prefs();
      await prefs.remove('ov_baseurl');
    } catch (_) {}
    notifyListeners();
  }

  // ================= login / logout =================

  /// Masuk mode demo (tanpa server).
  void loginDemo() {
    mode = AppMode.demo;
    pendingMfaToken = null;
    pendingWorkspaces = [];
    loggedIn = true;
    notifyListeners();
  }

  /// Login live langkah 1 (email + sandi). Hasil bisa: selesai, butuh kode
  /// MFA, atau butuh pilihan workspace — UI membaca stage di LoginResult.
  Future<LoginResult> loginLive(String email, String password) async {
    try {
      final res = await api.login(email, password);
      await _handleLoginResult(res);
      return res;
    } on ApiException catch (e) {
      return LoginResult(LoginStage.error, error: e.message);
    }
  }

  /// Login live langkah 2 (kode MFA 6 digit).
  Future<LoginResult> verifyMfaLive(String code) async {
    final token = pendingMfaToken;
    if (token == null) {
      return const LoginResult(
        LoginStage.error,
        error: 'Sesi MFA sudah kadaluarsa — masuk lagi.',
      );
    }
    try {
      final res = await api.verifyMfa(token, code);
      if (res.stage != LoginStage.mfaRequired) pendingMfaToken = null;
      await _handleLoginResult(res);
      return res;
    } on ApiException catch (e) {
      return LoginResult(LoginStage.error, error: e.message);
    }
  }

  Future<void> _handleLoginResult(LoginResult res) async {
    pendingMfaToken = res.mfaToken;
    pendingWorkspaces = res.stage == LoginStage.pickTenant
        ? res.workspaces
        : const [];
    if (res.stage == LoginStage.done) {
      mode = AppMode.live;
      loggedIn = true;
      _clearLocalOnlySeeds();
      await _saveSession();
      await refreshAll();
    }
    notifyListeners();
  }

  /// Batalkan langkah MFA — kembali ke form login biasa.
  void cancelMfaStep() {
    pendingMfaToken = null;
    notifyListeners();
  }

  /// Pilih workspace (akun multi-perusahaan) lalu muat data ESS.
  Future<String?> selectWorkspace(String tenantId) async {
    try {
      await api.selectTenant(tenantId);
      mode = AppMode.live;
      loggedIn = true;
      pendingWorkspaces = [];
      _clearLocalOnlySeeds();
      await _saveSession();
      await refreshAll();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  Future<void> logout() async {
    if (isLive) {
      await api.logout();
      await _clearSavedSession();
      kpi = const DashboardKpi();
      attSummary = const AttendanceSummary();
      letterTemplates = [];
      myShiftInfo = null;
      swapCandidates = [];
      medicalTypes = [];
      travelClaimForm = null;
      lastClaimDocNo = null;
      pendingWorkspaces = [];
      pendingMfaToken = null;
      attMonth = DateTime.now();
    }
    mode = AppMode.demo;
    loggedIn = false;
    _resetDemo();
    notifyListeners();
  }

  /// Seed yang hanya relevan di mode demo dibersihkan saat masuk live
  /// (riwayat whistleblow & jadwal mock tidak boleh tampil di data asli).
  void _clearLocalOnlySeeds() {
    whistleblows = [];
    schedule = [];
  }

  // ================= preferensi =================

  void togglePrivacy() {
    privacyMode = !privacyMode;
    notifyListeners();
  }

  void setThemeMode(ThemeMode mode) {
    themeMode = mode;
    notifyListeners();
  }

  // ================= refresh data live =================

  /// Muat ulang seluruh modul dari backend (paralel, per-modul tahan gagal).
  Future<void> refreshAll() async {
    if (!isLive) return;
    busy = true;
    notifyListeners();
    int unauthorized = 0;

    Future<void> guard(Future<void> Function() job) async {
      try {
        await job();
      } on ApiException catch (e) {
        if (e.unauthorized) unauthorized++;
      } catch (_) {}
    }

    final now = DateTime.now();
    final monthStr =
        '${attMonth.year.toString().padLeft(4, '0')}-${attMonth.month.toString().padLeft(2, '0')}';

    await Future.wait([
      guard(() async {
        employee = await api.me();
      }),
      guard(() async {
        kpi = await api.dashboardKpi();
      }),
      guard(() async {
        final (recs, summary) = await api.attendance(monthStr);
        attendance = recs;
        attSummary = summary;
      }),
      guard(() async {
        final (balances, reqs) = await api.leave();
        leaveBalances = balances;
        leaves = reqs;
      }),
      guard(() async {
        payslips = await api.payslips();
      }),
      guard(() async {
        claims = await api.claims();
      }),
      guard(() async {
        final (templates, reqs) = await api.letters();
        letterTemplates = templates;
        letters = reqs;
      }),
      guard(() async {
        announcements = await api.announcements();
      }),
      guard(() async {
        notifications = await api.notifications();
      }),
      guard(() async {
        assets = await api.assets();
      }),
      guard(() async {
        swaps = await api.mySwaps();
      }),
      guard(() async {
        requests = await api.dashboardRecent();
      }),
      guard(() async {
        final (my, candidates) = await api.swapBoard(now);
        myShiftInfo = my;
        swapCandidates = candidates;
      }),
      guard(() async {
        medicalTypes = await api.medicalClaimTypes();
      }),
      guard(() async {
        travelClaimForm = await api.travelClaimForm();
      }),
    ]);

    if (unauthorized >= 4) {
      // Sesi benar-benar mati → kembali ke login (jangan paksa demo).
      loggedIn = false;
      await _clearSavedSession();
    }
    busy = false;
    notifyListeners();
  }

  /// Refresh presensi bulan tertentu (navigasi bulan di halaman Presensi).
  Future<void> setAttendanceMonth(DateTime m) async {
    attMonth = DateTime(m.year, m.month);
    notifyListeners();
    if (!isLive) return;
    try {
      final monthStr =
          '${attMonth.year.toString().padLeft(4, '0')}-${attMonth.month.toString().padLeft(2, '0')}';
      final (recs, summary) = await api.attendance(monthStr);
      attendance = recs;
      attSummary = summary;
      notifyListeners();
    } on ApiException {
      // biarkan data bulan sebelumnya tetap tampil
    }
  }

  // ================= presensi =================

  AttendanceRecord? recordToday() {
    final today = DateTime.now();
    for (final r in attendance) {
      if (r.date.year == today.year &&
          r.date.month == today.month &&
          r.date.day == today.day) {
        return r;
      }
    }
    return null;
  }

  bool get isClockedIn => recordToday()?.checkIn != null;
  bool get isClockedOut => recordToday()?.checkOut != null;

  Future<String?> clockIn({double? lat, double? lng, String? note}) async {
    if (isClockedIn) return null;
    if (isLive) {
      try {
        final (_, t) = await api.clock('IN', lat: lat, lng: lng, note: note);
        _notifyUser(
          'Clock-in berhasil — semangat harimu! 💪',
          'Presensi tercatat ${t.replaceAll(':', '.')}.',
          'attendance',
        );
        await _refreshAttendanceQuiet();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    final now = DateTime.now();
    final late = now.hour > 8 || (now.hour == 8 && now.minute > 5);
    attendance.add(
      AttendanceRecord(
        DateTime(now.year, now.month, now.day),
        TimeOfDay.fromDateTime(now),
        null,
        late ? AttendanceStatus.late : AttendanceStatus.present,
        location: 'Kantor Pusat Jakarta',
      ),
    );
    _notifyUser(
      late
          ? 'Kamu tercatat terlambat'
          : 'Clock-in berhasil — semangat harimu! 💪',
      'Presensi tercatat ${_jam(now)} di Kantor Pusat Jakarta.',
      'attendance',
    );
    notifyListeners();
    return null;
  }

  Future<String?> clockOut({double? lat, double? lng, String? note}) async {
    if (isLive) {
      try {
        final (_, t) = await api.clock('OUT', lat: lat, lng: lng, note: note);
        _notifyUser(
          'Clock-out tercatat',
          'Presensi pulang tercatat ${t.replaceAll(':', '.')} — terima kasih, sampai besok! 👋',
          'attendance',
        );
        await _refreshAttendanceQuiet();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    final today = DateTime.now();
    for (final r in attendance) {
      if (r.date.year == today.year &&
          r.date.month == today.month &&
          r.date.day == today.day &&
          r.checkOut == null) {
        final now = TimeOfDay.fromDateTime(DateTime.now());
        final worked = _worked(r.checkIn!, now);
        attendance[attendance.indexOf(r)] = AttendanceRecord(
          r.date,
          r.checkIn,
          now,
          r.status,
          overtimeMinutes: worked > 540 ? ((worked - 540) ~/ 15) * 15 : 0,
          location: r.location,
        );
        _notifyUser(
          'Clock-out tercatat',
          'Kerja hari ini ${_fmtDur(worked)}. Terima kasih, sampai besok! 👋',
          'attendance',
        );
        break;
      }
    }
    notifyListeners();
    return null;
  }

  Future<void> _refreshAttendanceQuiet() async {
    try {
      final monthStr =
          '${attMonth.year.toString().padLeft(4, '0')}-${attMonth.month.toString().padLeft(2, '0')}';
      final (recs, summary) = await api.attendance(monthStr);
      attendance = recs;
      attSummary = summary;
    } catch (_) {}
    notifyListeners();
  }

  int _worked(TimeOfDay a, TimeOfDay b) =>
      b.hour * 60 + b.minute - (a.hour * 60 + a.minute);
  String _fmtDur(int m) =>
      m < 600 ? '$m menit' : '${(m / 60).toStringAsFixed(1)} jam';
  String _jam(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}';

  /// Statistik bulan aktif (demo menghitung dari record; live pakai
  /// attSummary dari backend — halaman boleh memilih salah satu).
  ({
    int hadir,
    int terlambat,
    int absen,
    int cuti,
    int lemburMenit,
    int totalMenit,
  })
  monthStats(DateTime month) {
    if (isLive) {
      return (
        hadir: attSummary.present,
        terlambat: attSummary.late,
        absen: attSummary.absent,
        cuti: attSummary.onLeave,
        lemburMenit: (attSummary.overtimeHours * 60).round(),
        totalMenit: attendance.fold<int>(0, (s, r) => s + r.workMinutes),
      );
    }
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
    return (
      hadir: hadir,
      terlambat: terlambat,
      absen: absen,
      cuti: cuti,
      lemburMenit: lembur,
      totalMenit: total,
    );
  }

  // ================= cuti =================

  Future<String?> submitLeave({
    required String type,
    String? typeId,
    required DateTimeRange range,
    required String reason,
    bool halfDay = false,
  }) async {
    final days = range.end.difference(range.start).inDays + 1;
    if (isLive) {
      final tid =
          typeId ??
          leaveBalances
              .where((b) => b.type == type && b.typeId != null)
              .firstOrNull
              ?.typeId;
      if (tid == null) {
        return 'Jenis cuti tidak dikenali — pilih ulang dari daftar.';
      }
      try {
        await api.submitLeave(
          typeId: tid,
          range: range,
          reason: reason,
          halfDay: halfDay,
        );
        _notifyUser(
          'Pengajuan cuti terkirim ✈️',
          'Pengajuan $days hari terkirim — pantau statusnya di menu Cuti.',
          'leave',
        );
        await refreshAll();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
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
        leaveBalances[i] = LeaveBalance(
          b.type,
          b.entitled,
          b.used + days,
          typeId: b.typeId,
          code: b.code,
          unit: b.unit,
          available: (b.sisa - days),
          applied: b.applied,
        );
        break;
      }
    }
    _notifyUser(
      'Pengajuan cuti terkirim ✈️',
      '$type $days hari — menunggu persetujuan atasan.',
      'leave',
    );
    notifyListeners();
    return null;
  }

  // ================= klaim =================

  /// Muat data form pengajuan klaim (jenis medis + opsi travel) — dipanggil
  /// saat sheet pengajuan dibuka. Paralel & tahan gagal per bagian; error
  /// ditelan (form memuat ulang saat dibuka lagi) → selalu return null.
  Future<String?> loadClaimForms() async {
    if (!isLive) return null;
    await Future.wait([
      () async {
        try {
          medicalTypes = await api.medicalClaimTypes();
        } catch (_) {}
      }(),
      () async {
        try {
          travelClaimForm = await api.travelClaimForm();
        } catch (_) {}
      }(),
    ]);
    notifyListeners();
    return null;
  }

  /// Pengajuan klaim medis.
  ///  - live : POST /ess/claims/medical → docNo tersimpan di [lastClaimDocNo],
  ///           riwayat + sisa plafon di-refresh; error → pesan ramah.
  ///  - demo : insert klaim lokal (perilaku lama tidak berubah).
  Future<String?> submitClaim({
    required String type,
    required String provider,
    required int amount,
    required String desc,
    DateTime? treatmentDate,
    String? receiptNo,
    bool forDependent = false,
    String? treatedName,
  }) async {
    if (isLive) {
      var info = medicalTypes.where((t) => t.name == type).firstOrNull;
      if (info == null) {
        // Jenis belum termuat (mis. refresh awal gagal) → coba muat ulang.
        await loadClaimForms();
        info = medicalTypes.where((t) => t.name == type).firstOrNull;
      }
      if (info == null) {
        return 'Jenis klaim "$type" belum terbaca dari server — '
            'tutup lalu buka ulang form, lalu pilih jenis dari daftar.';
      }
      try {
        lastClaimDocNo = await api.submitMedicalClaim(
          typeId: info.typeId,
          claimDate: DateTime.now(),
          forDependent: forDependent,
          lines: [
            {
              'treatedName': (treatedName == null || treatedName.trim().isEmpty)
                  ? employee.fullName
                  : treatedName.trim(),
              'treatment': desc,
              if (treatmentDate != null) 'treatmentDate': _ymd(treatmentDate),
              if (receiptNo != null && receiptNo.trim().isNotEmpty)
                'receiptNo': receiptNo.trim(),
              'hospital': provider,
              'billAmount': amount,
              'approvedAmount': amount,
            },
          ],
        );
        _notifyUser(
          'Klaim medis terkirim',
          'Klaim $type ${rupiah(amount)} menunggu persetujuan — kwitansi asli diserahkan ke HR untuk verifikasi.',
          'claim',
        );
        // Refresh ringan: riwayat klaim + sisa plafon form.
        try {
          claims = await api.claims();
        } catch (_) {}
        try {
          medicalTypes = await api.medicalClaimTypes();
        } catch (_) {}
        notifyListeners();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    claims.insert(
      0,
      Claim(
        _nextId('CL'),
        type,
        provider,
        desc,
        DateTime.now(),
        amount,
        'submitted',
        [
          ApprovalStep('Atasan Langsung', employee.manager, 'pending'),
          ApprovalStep('HR — Klaim', 'Sari Wulandari', 'pending'),
        ],
      ),
    );
    _notifyUser(
      'Klaim dikirim',
      'Klaim $type sedang diproses. Pantau statusnya di menu Klaim.',
      'claim',
    );
    notifyListeners();
    return null;
  }

  /// Pengajuan klaim / settlement perjalanan dinas (tab Klaim Travel).
  ///  - live : POST /ess/claims/travel (dasar = request dinas ATAU template
  ///           mandiri) → docNo di [lastClaimDocNo]; error → pesan ramah.
  ///  - demo : insert Claim travel lokal sederhana (tetap interaktif).
  Future<String?> submitTravelClaim({
    TravelRequestOption? request,
    TravelTemplateOption? template,
    required List<({String code, DateTime? date, String desc, int amount})>
    expenses,
    String? remark,
    double otherCompanyExp = 0,
    double exchangeLoss = 0,
  }) async {
    final total = expenses.fold<int>(0, (s, e) => s + e.amount);
    if (isLive) {
      if (request == null && (template == null || template.code.isEmpty)) {
        return 'Pilih dasar klaim dulu ya — pengajuan dinas atau template mandiri.';
      }
      try {
        lastClaimDocNo = await api.submitTravelClaim(
          requestId: request?.requestId,
          templateCode: request == null ? template!.code : null,
          remark: remark,
          expenses: [
            for (final e in expenses)
              {
                'expenseCode': e.code,
                'expenseDate': _ymd(e.date ?? DateTime.now()),
                'description': e.desc,
                'amount': e.amount,
              },
          ],
          otherCompanyExp: otherCompanyExp,
          exchangeLoss: exchangeLoss,
        );
        _notifyUser(
          'Klaim perjalanan dinas terkirim',
          'Pertanggungjawaban ${rupiah(total)} menunggu verifikasi HR/Finance — kwitansi tiap biaya diserahkan ke HR.',
          'claim',
        );
        // Refresh ringan: riwayat + daftar request (yang baru diklaim hilang).
        try {
          claims = await api.claims();
        } catch (_) {}
        try {
          travelClaimForm = await api.travelClaimForm();
        } catch (_) {}
        notifyListeners();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    claims.insert(
      0,
      Claim(
        _nextId('TRV'),
        'Perjalanan Dinas',
        'Travel',
        (remark != null && remark.trim().isNotEmpty)
            ? remark.trim()
            : 'Klaim perjalanan dinas',
        DateTime.now(),
        total,
        'submitted',
        const [],
        isTravel: true,
        advanceAmount: request?.advanceAmount,
        settlementAmount: total,
      ),
    );
    _notifyUser(
      'Klaim perjalanan dinas terkirim',
      'Pertanggungjawaban ${rupiah(total)} menunggu persetujuan.',
      'claim',
    );
    notifyListeners();
    return null;
  }

  // ================= lembur / workoff / travel =================

  Future<String?> submitOvertime({
    required DateTime date,
    required TimeOfDay start,
    required TimeOfDay end,
    required String reason,
  }) async {
    final hours =
        ((end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)) /
        60.0;
    if (isLive) {
      try {
        await api.submitOvertime(
          date: date,
          start: start,
          end: end,
          reason: reason,
        );
        _notifyUser(
          'Pengajuan lembur terkirim',
          'Lembur ${hours.abs().toStringAsFixed(1)} jam menunggu persetujuan atasan.',
          'request',
        );
        await refreshAll();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    requests.insert(
      0,
      MyRequest(
        _nextId('OT'),
        RequestKind.overtime,
        date,
        'Lembur — $reason',
        '${_fmtT(start)} – ${_fmtT(end)} · ${hours.toStringAsFixed(1)} jam',
        'submitted',
        DateTime.now(),
      ),
    );
    _notifyUser(
      'Pengajuan lembur terkirim',
      'Menunggu persetujuan atasan.',
      'request',
    );
    notifyListeners();
    return null;
  }

  Future<String?> submitWorkoff({
    required DateTime date,
    required String reason,
    bool halfDay = false,
  }) async {
    if (isLive) {
      try {
        await api.submitWorkoff(date: date, reason: reason, halfDay: halfDay);
        _notifyUser(
          'Pengajuan workoff terkirim',
          'Menunggu persetujuan atasan.',
          'request',
        );
        await refreshAll();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    requests.insert(
      0,
      MyRequest(
        _nextId('WO'),
        RequestKind.workoff,
        date,
        'Workoff',
        reason,
        'submitted',
        DateTime.now(),
      ),
    );
    _notifyUser(
      'Pengajuan workoff terkirim',
      'Menunggu persetujuan atasan.',
      'request',
    );
    notifyListeners();
    return null;
  }

  /// Pengajuan perjalanan dinas. Mode live: formulir travel lengkap
  /// (destinasi multi-kaki) ada di backoffice — mobile menampilkan status.
  Future<String?> submitTravel({
    required DateTimeRange range,
    required String destination,
    required String purpose,
  }) async {
    if (isLive) {
      return 'Pengajuan dinas dari aplikasi mobile belum dibuka — hubungi HR. '
          'Status & klaim perjalanan dinasmu tetap tampil di sini.';
    }
    final days = range.end.difference(range.start).inDays + 1;
    requests.insert(
      0,
      MyRequest(
        _nextId('TR'),
        RequestKind.travel,
        range.start,
        'Dinas ke $destination',
        '$days hari · $purpose · Uang muka diajukan',
        'submitted',
        DateTime.now(),
      ),
    );
    _notifyUser(
      'Pengajuan perjalanan dinas terkirim',
      'Menunggu persetujuan atasan & finance.',
      'request',
    );
    notifyListeners();
    return null;
  }

  // ================= tukar shift =================

  /// Muat papan tukar shift (jadwal saya + kandidat rekan) utk satu tanggal.
  Future<String?> loadSwapBoard(DateTime date) async {
    if (!isLive) return null;
    try {
      final (my, candidates) = await api.swapBoard(date);
      myShiftInfo = my;
      swapCandidates = candidates;
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  Future<String?> submitSwap({
    required DateTime date,
    String? targetId,
    String? colleague,
    DateTime? colleagueDate,
    required String reason,
  }) async {
    if (isLive) {
      if (targetId == null) return 'Pilih rekan tujuan tukar shift dulu.';
      try {
        await api.submitSwap(date: date, targetId: targetId, reason: reason);
        _notifyUser(
          'Permintaan tukar shift terkirim',
          'Menunggu respons rekan & persetujuan atasan.',
          'swap',
        );
        await refreshAll();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    swaps.insert(
      0,
      SwapOffer(
        _nextId('SW'),
        date,
        'Reguler 08.00–17.00',
        colleague ?? 'Rekan',
        colleagueDate ?? date,
        'Shift 2 13.00–22.00',
        'submitted',
      ),
    );
    _notifyUser(
      'Tawaran tukar shift dikirim',
      'Menunggu respons $colleague.',
      'swap',
    );
    notifyListeners();
    return null;
  }

  Future<String?> cancelSwap(String id) async {
    if (isLive) {
      try {
        await api.cancelSwap(id);
        swaps.removeWhere((s) => s.id == id);
        _notifyUser(
          'Permintaan tukar shift dibatalkan',
          'Kamu bisa mengajukan ulang kapan saja.',
          'swap',
        );
        notifyListeners();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    return null;
  }

  // ================= surat =================

  Future<String?> submitLetter({
    required String type,
    String? templateKey,
    String? purpose,
    String? notes,
  }) async {
    if (isLive) {
      final key =
          templateKey ??
          letterTemplates.where((t) => t.name == type).firstOrNull?.key;
      if (key == null) {
        return 'Jenis surat tidak dikenali — pilih ulang dari daftar.';
      }
      try {
        await api.submitLetter(
          templateKey: key,
          purpose: purpose,
          notes: notes,
        );
        _notifyUser(
          'Permintaan surat terkirim',
          'Surat $type sedang diproses HR (±2 hari kerja).',
          'letter',
        );
        await refreshAll();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    letters.insert(
      0,
      LetterRequest(
        _nextId('LT'),
        type,
        purpose ?? '',
        'submitted',
        DateTime.now(),
      ),
    );
    _notifyUser(
      'Permintaan surat terkirim',
      'Surat $type sedang diproses HR (±2 hari kerja).',
      'letter',
    );
    notifyListeners();
    return null;
  }

  /// Unduh PDF surat terbit — dipakai halaman Surat (share sheet).
  Future<http.Response> letterPdf(String id) => api.letterPdf(id);

  // ================= whistleblowing =================

  Future<String?> submitWhistleblow({
    required String category,
    required String categoryCode,
    required String description,
    required bool anonymous,
    DateTime? incidentDate,
    String? contact,
    String? location,
  }) async {
    if (isLive) {
      try {
        final ticket = await api.whistleblow(
          categoryCode: categoryCode,
          description: description,
          anonymous: anonymous,
          incidentDate: incidentDate,
          reporterContact: contact,
          location: location,
        );
        whistleblows.insert(
          0,
          WhistleblowReport(
            _nextId('WB'),
            ticket,
            category,
            description,
            DateTime.now(),
            'submitted',
          ),
        );
        _notifyUser(
          'Laporan diterima — terima kasih berani bicara 🛡️',
          'Kode pelacakan: $ticket. Identitas ${anonymous ? "tidak" : "tercatat"} dilampirkan sesuai pilihanmu.',
          'whistleblow',
        );
        notifyListeners();
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    }
    final ticket =
        'WB-2026-${(50 + whistleblows.length + 1).toString().padLeft(4, '0')}';
    whistleblows.insert(
      0,
      WhistleblowReport(
        _nextId('WB'),
        ticket,
        category,
        description,
        DateTime.now(),
        'submitted',
      ),
    );
    _notifyUser(
      'Laporan diterima — terima kasih berani bicara 🛡️',
      'Kode pelacakan: $ticket. Identitas ${anonymous ? "tidak" : "tercatat"} dilampirkan sesuai pilihanmu.',
      'whistleblow',
    );
    notifyListeners();
    return null;
  }

  // ================= notifikasi & pengumuman =================

  void _notifyUser(String title, String body, String kind) {
    notifications.insert(
      0,
      AppNotification(_nextId('NT'), title, body, DateTime.now(), kind, false),
    );
  }

  int get unreadCount => notifications.where((n) => !n.read).length;

  Future<void> markRead(AppNotification n) async {
    n.read = true;
    notifyListeners();
    if (isLive) {
      try {
        await api.markNotificationRead(n.id);
      } catch (_) {}
    }
  }

  Future<void> markAllRead() async {
    for (final n in notifications) {
      n.read = true;
    }
    notifyListeners();
    if (isLive) {
      try {
        await api.markAllNotificationsRead();
      } catch (_) {}
    }
  }

  Future<void> markAnnouncementRead(Announcement a) async {
    if (a.readByMe) return;
    final i = announcements.indexOf(a);
    if (i < 0) return;
    announcements[i] = Announcement(
      a.id,
      a.title,
      a.body,
      a.category,
      a.author,
      a.publishedAt,
      a.pinned,
      code: a.code,
      readByMe: true,
      totalReads: a.totalReads + 1,
    );
    notifyListeners();
    if (isLive) {
      try {
        await api.markAnnouncementRead(a.id);
      } catch (_) {}
    }
  }

  // ================= slip gaji =================

  /// Ambil rincian komponen satu slip (lazy — dipanggil saat slip dibuka).
  Future<Payslip> loadPayslipDetail(Payslip header) async {
    if (header.lineId == null || header.components.isNotEmpty) return header;
    return api.payslipDetail(header.lineId!, header);
  }

  // ================= internal =================

  void _resetDemo() {
    final now = DateTime.now();
    employee = demoEmployee;
    attendance = seedAttendance(now);
    leaveBalances = seedLeaveBalances();
    leaves = seedLeaves(now);
    payslips = seedPayslips();
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

  String _fmtT(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}.${t.minute.toString().padLeft(2, '0')}';

  static String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
