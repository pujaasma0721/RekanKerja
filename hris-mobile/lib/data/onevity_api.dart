import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'api_client.dart';
import 'models.dart';

/// Gateway bertipe ke backend OneVity (mode live).
///
/// Kontrak mengikuti modul ESS Next.js:
///   /api/auth/*            — login, MFA, pilih workspace, sesi
///   /api/onevity/ess/*    — seluruh data & aksi karyawan
///   /api/onevity/whistleblowing/report — laporan jalur aman
/// Seluruh mapper JSON→model berada di sini agar AppState bersih.
class OneVityApi {
  final ApiClient client;
  OneVityApi(this.client);

  // ================= util parsing =================

  static DateTime _date(String s) {
    final p = s.split('-');
    return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
  }

  static DateTime? _isoOpt(String? s) =>
      (s == null || s.isEmpty) ? null : DateTime.parse(s);

  static TimeOfDay? _timeOpt(String? s) {
    if (s == null || s.isEmpty) return null;
    final p = s.split(':');
    return TimeOfDay(hour: int.parse(p[0]), minute: int.parse(p[1]));
  }

  static String _hhmm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  static String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static String _status(String? s) => (s ?? '').trim().toLowerCase();

  static int _int(dynamic v, [int fallback = 0]) => v == null
      ? fallback
      : (v is num ? v.round() : int.tryParse(v.toString()) ?? fallback);

  static double _dbl(dynamic v, [double fallback = 0]) => v == null
      ? fallback
      : (v is num ? v.toDouble() : double.tryParse(v.toString()) ?? fallback);

  static const _bulanIdx = {
    'JANUARI': 1,
    'FEBRUARI': 2,
    'MARET': 3,
    'APRIL': 4,
    'MEI': 5,
    'JUNI': 6,
    'JULI': 7,
    'AGUSTUS': 8,
    'SEPTEMBER': 9,
    'OKTOBER': 10,
    'NOVEMBER': 11,
    'DESEMBER': 12,
  };

  /// "AGUSTUS 2026" → (2026, 8); gagal → (0, 0).
  static (int, int) _period(String? name) {
    if (name == null) return (0, 0);
    final parts = name.trim().toUpperCase().split(RegExp(r'\s+'));
    if (parts.length < 2) return (0, 0);
    final m = _bulanIdx[parts[parts.length - 2]];
    final y = int.tryParse(parts.last);
    if (m == null || y == null) return (0, 0);
    return (y, m);
  }

  static Workspace _workspace(Map j) => Workspace(
    j['id'] as String,
    (j['name'] ?? '') as String,
    j['companyCode'] as String?,
    j['slug'] as String?,
    (j['role'] ?? '') as String,
  );

  LoginResult _sessionResult(Map b) {
    if (b['mfaRequired'] == true) {
      return LoginResult(
        LoginStage.mfaRequired,
        mfaToken: b['mfaToken'] as String?,
      );
    }
    final workspaces = (b['workspaces'] as List? ?? [])
        .whereType<Map>()
        .map((w) => _workspace(Map<String, dynamic>.from(w)))
        .toList();
    Workspace? tenant;
    final t = b['tenant'];
    if (t is Map) tenant = _workspace(Map<String, dynamic>.from(t));
    return LoginResult(
      tenant != null ? LoginStage.done : LoginStage.pickTenant,
      workspaces: workspaces,
      tenant: tenant,
    );
  }

  // ================= AUTH =================

  /// Langkah 1: email + kata sandi. Bisa berakhir di sini (sesi siap),
  /// minta kode MFA, atau minta pilihan workspace.
  Future<LoginResult> login(String email, String password) async {
    final b = await client.postJson('/api/auth/login', {
      'email': email.trim(),
      'password': password,
    });
    return _sessionResult(b);
  }

  /// Langkah 2 (bila MFA aktif): tukar mfaToken + kode 6 digit → sesi.
  Future<LoginResult> verifyMfa(String mfaToken, String code) async {
    final b = await client.postJson('/api/auth/mfa/verify', {
      'mfaToken': mfaToken,
      'token': code.trim(),
    });
    return _sessionResult(b);
  }

  /// Pilih workspace (tenant) — sesi di-refresh dengan tenant terpilih.
  Future<void> selectTenant(String tenantId) async {
    await client.postJson('/api/auth/select-tenant', {'tenantId': tenantId});
  }

  /// Info sesi saat ini (juga memperbarui cookie sliding-expiry).
  Future<LoginResult> sessionInfo() async {
    final b = await client.getJson('/api/auth/me');
    return _sessionResult(b);
  }

  /// Keluar — revoke sesi server-side lalu buang cookie.
  Future<void> logout() async {
    try {
      await client.postJson('/api/auth/logout', {});
    } catch (_) {
      /* best effort */
    }
    client.sessionCookie = null;
  }

  // ================= ESS: PROFIL =================

  Future<Employee> me() async {
    final b = await client.getJson('/api/onevity/ess/me');
    final e = (b['employee'] as Map).cast<String, dynamic>();
    final full = (e['fullName'] ?? '') as String;
    return Employee(
      id: e['id'] as String,
      employeeNo: (e['employeeNo'] ?? '') as String,
      fullName: full,
      nickname: full.split(' ').first,
      email: (e['email'] ?? '') as String,
      phone: (e['phone'] ?? '') as String,
      position: (e['positionTitle'] ?? '—') as String,
      unit: (e['orgUnitName'] ?? '—') as String,
      office: (b['companyName'] ?? '—') as String,
      grade: (e['gradeCode'] ?? '—') as String,
      employmentStatus: (e['employmentStatus'] ?? '—') as String,
      manager: (e['managerName'] ?? '—') as String,
      joinDate: _date(e['joinDate'] as String),
      photoUrl: e['photoUrl'] as String?,
      companyName: b['companyName'] as String?,
      levelCode: e['levelCode'] as String?,
      taxId: e['taxId'] as String?,
      bpjsHealth: e['bpjsHealth'] as String?,
      bpjsEmpSkill: e['bpjsEmpSkill'] as String?,
    );
  }

  // ================= ESS: DASHBOARD =================

  Future<DashboardKpi> dashboardKpi() async {
    final b = await client.getJson('/api/onevity/ess/dashboard');
    final k = (b['kpi'] as Map).cast<String, dynamic>();
    return DashboardKpi(
      leaveAvailable: _dbl(k['leaveAvailable']),
      pendingMine: _int(k['pendingMine']),
      waitingApproval: _int(k['waitingApproval']),
      present: _int(k['present']),
      late: _int(k['late']),
      absent: _int(k['absent']),
      overtimeHoursMonth: _dbl(k['overtimeHoursMonth']),
    );
  }

  /// Saldo cuti ringkas dari dashboard (code+name+available).
  Future<List<LeaveBalance>> dashboardBalances() async {
    final b = await client.getJson('/api/onevity/ess/dashboard');
    final arr = (b['leaveBalances'] as List? ?? []).whereType<Map>();
    return [
      for (final m in arr)
        LeaveBalance(
          (m['name'] ?? '') as String,
          _dbl(m['available']).round(),
          0,
          code: m['code'] as String?,
          available: _dbl(m['available']),
        ),
    ];
  }

  /// Dokumen terbaru lintas modul (feed "Pengajuanku").
  /// Leave & Medical dilewati — keduanya punya halaman tersendiri.
  Future<List<MyRequest>> dashboardRecent() async {
    final b = await client.getJson('/api/onevity/ess/dashboard');
    final arr = (b['recentRequests'] as List? ?? []).whereType<Map>();
    return [
      for (final m in arr)
        if (switch ((m['docType'] ?? '') as String) {
          'WorkOff' => true,
          'Overtime' => true,
          'Travel' => true,
          'Swap' => true,
          _ => false,
        })
          MyRequest(
            (m['docNo'] ?? '') as String,
            switch ((m['docType'] ?? '') as String) {
              'WorkOff' => RequestKind.workoff,
              'Travel' => RequestKind.travel,
              'Swap' => RequestKind.swap,
              _ => RequestKind.overtime,
            },
            DateTime.now(),
            '${m['docType']} ${(m['docNo'] ?? '')}',
            (m['dateLabel'] ?? '') as String,
            _status(m['status'] as String?),
            DateTime.now(),
            docNo: (m['docNo'] ?? '') as String,
          ),
    ];
  }

  /// Clock-in/out hari ini dari dashboard.
  Future<(TimeOfDay?, TimeOfDay?)> dashboardClock() async {
    final b = await client.getJson('/api/onevity/ess/dashboard');
    final c = b['clockToday'];
    if (c is! Map) return (null, null);
    return (_timeOpt(c['in'] as String?), _timeOpt(c['out'] as String?));
  }

  // ================= ESS: PRESENSI =================

  Future<(List<AttendanceRecord>, AttendanceSummary)> attendance([
    String? month,
  ]) async {
    final q = month == null ? null : {'month': month};
    final b = await client.getJson('/api/onevity/ess/attendance', q);
    final days = (b['days'] as List? ?? []).whereType<Map>();
    final records = [
      for (final d in days)
        AttendanceRecord(
          _date(d['date'] as String),
          _timeOpt(d['clockIn'] as String?),
          _timeOpt(d['clockOut'] as String?),
          switch ((d['status'] ?? '') as String) {
            'Present' => AttendanceStatus.present,
            'Late' => AttendanceStatus.late,
            'Absent' => AttendanceStatus.absent,
            'OnLeave' => AttendanceStatus.leave,
            'WorkOff' => AttendanceStatus.workoff,
            _ => AttendanceStatus.weekend,
          },
          overtimeMinutes: _int(d['overtimeMinutes']),
          dayTypeCode: d['dayTypeCode'] as String?,
          lateMinutes: _int(d['lateMinutes']),
          earlyMinutes: _int(d['earlyMinutes']),
          workMinutes: _int(d['workMinutes']),
        ),
    ];
    final s = (b['summary'] as Map?)?.cast<String, dynamic>() ?? const {};
    final summary = AttendanceSummary(
      present: _int(s['present']),
      late: _int(s['late']),
      absent: _int(s['absent']),
      off: _int(s['off']),
      onLeave: _int(s['onLeave']),
      workoff: _int(s['workoff']),
      overtimeHours: _dbl(s['overtimeHours']),
    );
    return (records, summary);
  }

  Future<(String, String)> clock(
    String direction, {
    double? lat,
    double? lng,
    String? note,
  }) async {
    final b = await client.postJson('/api/onevity/ess/clock', {
      'direction': direction,
      if (lat != null) 'latitude': lat,
      if (lng != null) 'longitude': lng,
      if (note != null && note.isNotEmpty) 'note': note,
    });
    final t = (b['time'] ?? '') as String;
    return (direction, t);
  }

  // ================= ESS: CUTI =================

  Future<(List<LeaveBalance>, List<LeaveRequest>)> leave() async {
    final b = await client.getJson('/api/onevity/ess/leave');
    final balances = [
      for (final m in (b['balances'] as List? ?? []).whereType<Map>())
        LeaveBalance(
          (m['name'] ?? '') as String,
          _dbl(m['entitlement']).round(),
          _int(m['taken']),
          typeId: m['typeId'] as String?,
          code: m['code'] as String?,
          unit: m['unit'] as String?,
          available: _dbl(m['available']),
          applied: _int(m['applied']),
        ),
    ];
    final requests = [
      for (final m in (b['requests'] as List? ?? []).whereType<Map>())
        LeaveRequest(
          id: (m['id'] ?? m['docNo'] ?? '') as String,
          type: (m['typeName'] ?? '') as String,
          from: _date(m['dateFrom'] as String),
          to: _date(m['dateTo'] as String),
          days: _dbl(m['days']).round(),
          reason: (m['reason'] ?? '') as String,
          status: _status(m['status'] as String?),
          submittedAt: DateTime.now(),
          docNo: m['docNo'] as String?,
          typeId: m['typeId'] as String?,
          currentApprover:
              ((m['approval'] as Map?)?['currentApproverName']) as String?,
        ),
    ];
    return (balances, requests);
  }

  Future<void> submitLeave({
    required String typeId,
    required DateTimeRange range,
    required String reason,
    bool halfDay = false,
  }) async {
    await client.postJson('/api/onevity/ess/leave', {
      'typeId': typeId,
      'dateFrom': _ymd(range.start),
      'dateTo': _ymd(range.end),
      'halfDay': halfDay,
      'reason': reason,
    });
  }

  // ================= ESS: SLIP GAJI =================

  Future<List<Payslip>> payslips() async {
    final b = await client.getJson('/api/onevity/ess/payslips');
    final arr = (b['slips'] as List? ?? []).whereType<Map>();
    return [
      for (final m in arr)
        Payslip(
          _period(m['periodName'] as String?).$1,
          _period(m['periodName'] as String?).$2,
          _int(m['net']),
          _int(m['gross']),
          0,
          const [],
          lineId: m['lineId'] as String?,
          periodName: m['periodName'] as String?,
          status: m['status'] as String?,
          paidAt: _isoOpt(m['paidAt'] as String?),
        ),
    ];
  }

  /// Rincian satu slip (dipanggil saat dibuka).
  Future<Payslip> payslipDetail(String lineId, Payslip header) async {
    final b = await client.getJson('/api/onevity/ess/payslips/detail', {
      'lineId': lineId,
    });
    final comps = [
      for (final m in (b['items'] as List? ?? []).whereType<Map>())
        PayComponent(
          (m['name'] ?? '') as String,
          _int(m['amount']),
          isDeduction: m['kind'] == 'deduction',
        ),
    ];
    return Payslip(
      header.year,
      header.month,
      _int(b['net']),
      _int(b['gross']),
      _int(b['totalDeductions']),
      comps,
      lineId: lineId,
      periodName: (b['periodName'] ?? header.periodName) as String?,
      status: header.status,
      paidAt: header.paidAt,
      totalDeductions: _int(b['totalDeductions']),
      employeeName: b['employeeName'] as String?,
    );
  }

  // ================= ESS: KLAIM =================

  Future<List<Claim>> claims() async {
    final b = await client.getJson('/api/onevity/ess/claims');
    final out = <Claim>[];
    for (final m in (b['medical'] as List? ?? []).whereType<Map>()) {
      final submitted = _isoOpt(m['submittedAt'] as String?) ?? DateTime.now();
      out.add(
        Claim(
          (m['docNo'] ?? '') as String,
          (m['typeName'] ?? '') as String,
          'Klaim Medis',
          (m['typeName'] ?? '') as String,
          submitted,
          _int(m['bill']),
          _status(m['status'] as String?),
          const [],
          docNo: m['docNo'] as String?,
          approvedAmount: m['approved'] == null ? null : _int(m['approved']),
          submittedAt: submitted,
        ),
      );
    }
    for (final m in (b['travel'] as List? ?? []).whereType<Map>()) {
      out.add(
        Claim(
          (m['docNo'] ?? '') as String,
          'Perjalanan Dinas',
          'Travel',
          (m['purpose'] ?? '') as String,
          DateTime.now(),
          _int(m['advance']),
          _status(m['status'] as String?),
          const [],
          docNo: m['docNo'] as String?,
          isTravel: true,
          advanceAmount: _int(m['advance']),
          settlementAmount: m['settlement'] == null
              ? null
              : _int(m['settlement']),
        ),
      );
    }
    return out;
  }

  // ================= ESS: PENGAJUAN KLAIM (medis & travel) =================

  /// Jenis benefit medis aktif + snapshot sisa plafon (form pengajuan).
  Future<List<MedClaimTypeInfo>> medicalClaimTypes() async {
    final b = await client.getJson('/api/onevity/ess/claims/medical');
    return [
      for (final m in (b['types'] as List? ?? []).whereType<Map>())
        MedClaimTypeInfo(
          typeId: (m['typeId'] ?? '') as String,
          code: (m['code'] ?? '') as String,
          name: (m['name'] ?? '') as String,
          limitRule: (m['limitRule'] ?? '') as String,
          needReceipt: m['needReceipt'] == true,
          dependentEnabled: m['dependentEnabled'] == true,
          freqUnlimited: m['freqUnlimited'] == true,
          freqValue: _int(m['freqValue']),
          remainingForClaim: _dbl(m['remainingForClaim']),
          pendingReserved: _dbl(m['pendingReserved']),
          claimCountYear: _int(m['claimCountYear']),
          benefitAmount: _dbl(m['benefitAmount']),
        ),
    ];
  }

  /// Ajukan klaim medis untuk diri sendiri / dependent.
  /// `lines` mengikuti kontrak backend:
  /// `{treatedName, treatment, treatmentDate, receiptNo, physician,
  ///   hospital, billAmount, approvedAmount}` (angka int).
  /// Respons 201 berisi docNo — dikembalikan ke pemanggil.
  Future<String> submitMedicalClaim({
    required String typeId,
    required DateTime claimDate,
    required List<Map<String, dynamic>> lines,
    bool forDependent = false,
    String? note,
  }) async {
    final b = await client.postJson('/api/onevity/ess/claims/medical', {
      'typeId': typeId,
      'claimDate': _ymd(claimDate),
      'forDependent': forDependent,
      if (note != null && note.isNotEmpty) 'note': note,
      'lines': lines,
    });
    return (b['docNo'] ?? '') as String;
  }

  /// Data form klaim perjalanan dinas: pengajuan Approved yang belum
  /// diklaim, template (klaim mandiri), dan daftar jenis biaya.
  Future<TravelClaimFormData> travelClaimForm() async {
    final b = await client.getJson('/api/onevity/ess/claims/travel');
    return TravelClaimFormData(
      requests: [
        for (final m in (b['requests'] as List? ?? []).whereType<Map>())
          TravelRequestOption(
            requestId: (m['requestId'] ?? m['id'] ?? '') as String,
            docNo: (m['docNo'] ?? '') as String,
            dateFrom: _date(m['dateFrom'] as String),
            dateTo: _date(m['dateTo'] as String),
            days: _int(m['days']),
            purpose: (m['purpose'] ?? '') as String,
            destinations: [
              for (final d in (m['destinations'] as List? ?? [])) d.toString(),
            ],
            templateCode: (m['templateCode'] ?? '') as String,
            templateName: (m['templateName'] ?? '') as String,
            advanceAmount: _int(m['advanceAmount']),
          ),
      ],
      templates: [
        for (final m in (b['templates'] as List? ?? []).whereType<Map>())
          TravelTemplateOption(
            (m['code'] ?? '') as String,
            (m['name'] ?? '') as String,
          ),
      ],
      expenseTypes: [
        for (final m in (b['expenseTypes'] as List? ?? []).whereType<Map>())
          TravelExpenseTypeOption(
            code: (m['code'] ?? '') as String,
            name: (m['name'] ?? '') as String,
            kind: (m['kind'] ?? '') as String,
            needDocs: m['needDocs'] == true,
            limitAmount: _dbl(m['limitAmount']),
            unlimited: m['unlimited'] == true,
          ),
      ],
    );
  }

  /// Ajukan klaim/settlement perjalanan dinas. Dengan `requestId` →
  /// template & jendela tanggal dari pengajuan dinas; tanpa request
  /// (klaim mandiri) → `templateCode` wajib. Respons 201 berisi docNo.
  Future<String> submitTravelClaim({
    String? requestId,
    String? templateCode,
    String? remark,
    required List<Map<String, dynamic>> expenses,
    double otherCompanyExp = 0,
    double exchangeLoss = 0,
  }) async {
    final b = await client.postJson('/api/onevity/ess/claims/travel', {
      if (requestId != null && requestId.isNotEmpty) 'requestId': requestId,
      if (requestId == null || requestId.isEmpty)
        'templateCode': templateCode ?? '',
      if (remark != null && remark.isNotEmpty) 'remark': remark,
      'expenses': expenses,
      'otherCompanyExp': otherCompanyExp,
      'exchangeLoss': exchangeLoss,
    });
    return (b['docNo'] ?? '') as String;
  }

  // ================= ESS: LEMBUR / WORKOFF =================

  Future<void> submitOvertime({
    required DateTime date,
    required TimeOfDay start,
    required TimeOfDay end,
    required String reason,
  }) async {
    await client.postJson('/api/onevity/ess/overtime', {
      'date': _ymd(date),
      'planStart': _hhmm(start),
      'planEnd': _hhmm(end),
      'reason': reason,
    });
  }

  Future<void> submitWorkoff({
    required DateTime date,
    required String reason,
    bool halfDay = false,
  }) async {
    await client.postJson('/api/onevity/ess/workoff', {
      'dateFrom': _ymd(date),
      if (halfDay) 'dateTo': _ymd(date),
      'halfDay': halfDay,
      'paid': true,
      'reason': reason,
    });
  }

  // ================= ESS: TUKAR SHIFT =================

  /// Papan tukar shift untuk satu tanggal: jadwal saya + kandidat rekan.
  Future<(SwapMyShift, List<SwapCandidate>)> swapBoard(DateTime date) async {
    final b = await client.getJson('/api/onevity/ess/swap', {
      'date': _ymd(date),
    });
    final m = (b['myShift'] as Map?)?.cast<String, dynamic>() ?? const {};
    final dt = m['dayType'] as Map?;
    final candidates = [
      for (final c in (b['candidates'] as List? ?? []).whereType<Map>())
        SwapCandidate(
          employeeId: (c['employeeId'] ?? '') as String,
          employeeNo: (c['employeeNo'] ?? '') as String,
          fullName: (c['fullName'] ?? '') as String,
          unitName: c['unitName'] as String?,
          dayTypeName: ((c['dayType'] as Map?)?['name'] ?? '') as String,
          timeLabel: (c['timeLabel'] ?? '') as String,
        ),
    ];
    final my = SwapMyShift(
      scheduleName: m['scheduleName'] as String?,
      dayTypeName: (dt?['name'] ?? m['scheduleName']) as String?,
      timeIn: dt?['timeIn'] as String?,
      timeOut: dt?['timeOut'] as String?,
      hasAssignment: m['hasAssignment'] == true,
      clockingRequired: m['clockingRequired'] == true,
      holidayName: ((m['holiday'] as Map?)?['name']) as String?,
    );
    return (my, candidates);
  }

  /// Riwayat tukar shift: permintaanku + permintaan ke saya.
  Future<List<SwapOffer>> mySwaps() async {
    final b = await client.getJson('/api/onevity/ess/swap');
    final out = <SwapOffer>[];
    for (final key in ['mine', 'toMe']) {
      for (final m in ((b[key] as List?) ?? []).whereType<Map>()) {
        final reqName =
            (((m['requester'] as Map?)?['fullName']) ?? '') as String;
        final tgtName = (((m['target'] as Map?)?['fullName']) ?? '') as String;
        out.add(
          SwapOffer(
            (m['id'] ?? '') as String,
            _date(m['swapDate'] as String),
            (m['requesterScheduleName'] ?? '') as String,
            key == 'mine' ? tgtName : reqName,
            _date(m['swapDate'] as String),
            (m['targetScheduleName'] ?? '') as String,
            _status(m['status'] as String?),
            code: (m['code'] ?? '') as String,
            reason: m['reason'] as String?,
            decisionNote: m['decisionNote'] as String?,
          ),
        );
      }
    }
    return out;
  }

  Future<void> submitSwap({
    required DateTime date,
    required String targetId,
    required String reason,
  }) async {
    await client.postJson('/api/onevity/ess/swap', {
      'targetId': targetId,
      'date': _ymd(date),
      'reason': reason,
    });
  }

  Future<void> cancelSwap(String id) async {
    await client.patchJson('/api/onevity/ess/swap', {
      'id': id,
      'action': 'cancel',
    });
  }

  // ================= ESS: SURAT =================

  Future<(List<LetterTemplate>, List<LetterRequest>)> letters() async {
    final b = await client.getJson('/api/onevity/ess/letters');
    final templates = [
      for (final m in (b['templates'] as List? ?? []).whereType<Map>())
        LetterTemplate(
          (m['key'] ?? '') as String,
          (m['name'] ?? '') as String,
          m['description'] as String?,
        ),
    ];
    final requests = [
      for (final m in (b['requests'] as List? ?? []).whereType<Map>())
        LetterRequest(
          (m['id'] ?? '') as String,
          (m['templateName'] ?? '') as String,
          (m['purpose'] ?? '') as String,
          _status(m['status'] as String?),
          _isoOpt(m['createdAt'] as String?) ?? DateTime.now(),
          reqNo: m['reqNo'] as String?,
          templateKey: m['templateKey'] as String?,
          notes: m['notes'] as String?,
          letterRefNo: m['letterRefNo'] as String?,
          issuedAt: _isoOpt(m['issuedAt'] as String?),
          rejectReason: m['rejectReason'] as String?,
        ),
    ];
    return (templates, requests);
  }

  Future<void> submitLetter({
    required String templateKey,
    String? purpose,
    String? notes,
  }) async {
    await client.postJson('/api/onevity/ess/letters', {
      'templateKey': templateKey,
      if (purpose != null && purpose.isNotEmpty) 'purpose': purpose,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
  }

  /// Unduh PDF surat yang sudah terbit (status Issued).
  Future<http.Response> letterPdf(String id) =>
      client.getRaw('/api/onevity/ess/letters/$id/pdf');

  // ================= ESS: PENGUMUMAN =================

  Future<List<Announcement>> announcements() async {
    final b = await client.getJson('/api/onevity/ess/announcements');
    return [
      for (final m in (b['announcements'] as List? ?? []).whereType<Map>())
        Announcement(
          (m['id'] ?? '') as String,
          (m['title'] ?? '') as String,
          (m['body'] ?? '') as String,
          (m['category'] ?? 'Umum') as String,
          '',
          _isoOpt(m['publishedAt'] as String?) ?? DateTime.now(),
          m['pinned'] == true,
          code: m['code'] as String?,
          readByMe: m['readByMe'] == true,
          totalReads: _int(m['totalReads']),
        ),
    ];
  }

  Future<void> markAnnouncementRead(String id) async {
    await client.postJson('/api/onevity/ess/announcements', {'id': id});
  }

  // ================= ESS: NOTIFIKASI =================

  Future<List<AppNotification>> notifications() async {
    final b = await client.getJson('/api/onevity/ess/notifications');
    return [
      for (final m in (b['items'] as List? ?? []).whereType<Map>())
        AppNotification(
          (m['id'] ?? '') as String,
          (m['title'] ?? '') as String,
          (m['body'] ?? '') as String,
          _isoOpt(m['createdAt'] as String?) ?? DateTime.now(),
          'system',
          m['readAt'] != null,
        ),
    ];
  }

  Future<void> markNotificationRead(String id) async {
    await client.postJson('/api/onevity/ess/notifications/read', {'id': id});
  }

  Future<void> markAllNotificationsRead() async {
    await client.postJson('/api/onevity/ess/notifications/read', {'all': true});
  }

  // ================= ESS: ASET =================

  Future<List<AssetItem>> assets() async {
    final b = await client.getJson('/api/onevity/ess/assets');
    final out = <AssetItem>[];
    for (final key in ['active', 'history']) {
      for (final m in ((b[key] as List?) ?? []).whereType<Map>()) {
        final a = (m['asset'] as Map?) ?? const {};
        out.add(
          AssetItem(
            (m['id'] ?? '') as String,
            (a['name'] ?? '') as String,
            (a['code'] ?? '') as String,
            (a['serialNumber'] ?? '—') as String,
            (a['category'] ?? '') as String,
            _isoOpt(m['assignedAt'] as String?) ?? DateTime.now(),
            key == 'active' ? 'Dipakai' : 'Dikembalikan',
            dueAt: _isoOpt(m['dueAt'] as String?),
            returnedAt: _isoOpt(m['returnedAt'] as String?),
            returnCondition: m['returnCondition'] as String?,
            notes: m['notes'] as String?,
            value: a['value'] == null ? null : _int(a['value']),
          ),
        );
      }
    }
    return out;
  }

  // ================= WHISTLEBLOWING =================

  static const wbCategories = {
    'KEKERASAN_SEKSUAL': 'Kekerasan Seksual',
    'PELECEHAN': 'Pelecehan',
    'BULLYING': 'Bullying / Perundungan',
    'RETALIASI': 'Retaliasi',
    'FRAUD': 'Fraud / Kecurangan',
    'KESELAMATAN': 'Keselamatan Kerja (K3)',
    'LAINNYA': 'Lainnya',
  };

  /// Kirim laporan jalur aman. Respon berisi nomor tiket pelacakan.
  Future<String> whistleblow({
    required String categoryCode,
    required String description,
    bool anonymous = true,
    DateTime? incidentDate,
    String? reporterContact,
    String? involvedHint,
    String? location,
  }) async {
    final b = await client.postJson('/api/onevity/whistleblowing/report', {
      'category': categoryCode,
      'description': description,
      'anonymous': anonymous,
      if (incidentDate != null) 'incidentDate': _ymd(incidentDate),
      if (reporterContact != null && reporterContact.isNotEmpty)
        'reporterContact': reporterContact,
      if (involvedHint != null && involvedHint.isNotEmpty)
        'involvedHint': involvedHint,
      if (location != null && location.isNotEmpty) 'location': location,
    });
    return (b['ticketNo'] ?? 'WB-????') as String;
  }
}
