import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';
import 'claims.dart';
import 'leave.dart';
import 'letters.dart';
import 'payslip.dart';
import 'requests.dart';
import 'shell.dart';

/// Dashboard employee-centric: sapaan personal, presensi satu-tap,
/// ringkasan hidup, dan pintasan ke semua kebutuhan.
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  late Timer _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final emp = app.employee;
    // Subtitle header: posisi · unit (live bisa kosong → nama perusahaan).
    final subParts = [
      emp.position,
      emp.unit,
    ].where((s) => s.trim().isNotEmpty && s != '—').toList();
    if (subParts.isEmpty) {
      final co = emp.companyName ?? emp.office;
      if (co.trim().isNotEmpty && co != '—') subParts.add(co);
    }
    final empSubtitle = subParts.join(' · ');

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            // Refresh global berjalan (live) — bar tipis, tidak memblokir UI.
            if (app.busy) const LinearProgressIndicator(minHeight: 2),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => app.refreshAll(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 120),
                  children: [
                    // ===== Header =====
                    Row(
                      children: [
                        GestureDetector(
                          onTap: () {},
                          child: AppAvatar(emp.fullName, size: 46),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${sapaan(_now)}, ${emp.nickname} 👋',
                                style: const TextStyle(
                                  fontSize: 16.5,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.3,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                empSubtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: Theme.of(context).hintColor,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        _bellButton(context, app),
                      ],
                    ),

                    const SizedBox(height: 18),

                    // ===== Kartu Presensi =====
                    _ClockCard(app: app, now: _now),

                    const SizedBox(height: 16),

                    // ===== Statistik ringkas =====
                    Row(
                      children: [
                        Expanded(
                          child: StatTile(
                            icon: Icons.beach_access_rounded,
                            color: const Color(0xFF059669),
                            value: app.isLive
                                ? '${_fmtHari(app.kpi.leaveAvailable)} hari'
                                : '${app.leaveBalances.first.entitled - app.leaveBalances.first.used} hari',
                            label: 'Sisa cuti tahunan',
                            onTap: () => _push(context, const LeavePage()),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: StatTile(
                            icon: Icons.local_fire_department_rounded,
                            color: const Color(0xFFB45309),
                            value: app.isLive
                                ? durasi(
                                    (app.kpi.overtimeHoursMonth * 60).round(),
                                  )
                                : durasi(
                                    app
                                        .monthStats(
                                          DateTime(_now.year, _now.month),
                                        )
                                        .lemburMenit,
                                  ),
                            label: 'Lembur bulan ini',
                            onTap: () => _push(context, const RequestsPage()),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: StatTile(
                            icon: Icons.pending_actions_rounded,
                            color: const Color(0xFFBE123C),
                            value: app.isLive
                                ? '${app.kpi.pendingMine} pengajuan'
                                : '${app.claims.where((c) => c.status == 'pending' || c.status == 'submitted').length} klaim',
                            label: 'Sedang jalan',
                            onTap: () => _push(context, const ClaimsPage()),
                          ),
                        ),
                      ],
                    ),

                    // ===== Pengajuan terbaru (feed lintas modul) =====
                    if (app.requests.isNotEmpty) ...[
                      SectionTitle(
                        'Pengajuanku terbaru',
                        action: 'Semua',
                        onAction: () => _push(context, const RequestsPage()),
                      ),
                      ...app.requests
                          .take(3)
                          .map(
                            (r) => _RecentRequestTile(r: r, live: app.isLive),
                          ),
                    ],

                    // ===== Pintasan =====
                    const SectionTitle('Pintasan buat kamu'),
                    GridView.count(
                      crossAxisCount: 4,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 0.92,
                      children: [
                        QuickAction(
                          icon: Icons.beach_access_rounded,
                          color: const Color(0xFF059669),
                          label: 'Ajukan Cuti',
                          onTap: () => _push(context, const LeavePage()),
                        ),
                        QuickAction(
                          icon: Icons.schedule_rounded,
                          color: const Color(0xFFB45309),
                          label: 'Lembur',
                          onTap: () => _push(context, const RequestsPage()),
                        ),
                        QuickAction(
                          icon: Icons.medical_services_rounded,
                          color: const Color(0xFFBE123C),
                          label: 'Klaim',
                          onTap: () => _push(context, const ClaimsPage()),
                        ),
                        QuickAction(
                          icon: Icons.description_rounded,
                          color: const Color(0xFF0369A1),
                          label: 'Surat',
                          onTap: () => _push(context, const LettersPage()),
                        ),
                      ],
                    ),

                    // ===== Slip gaji terakhir =====
                    SectionTitle(
                      'Kantong gaji 💸',
                      action: 'Lihat semua',
                      onAction: () => _push(context, const PayslipPage()),
                    ),
                    _PayslipTeaser(app: app),

                    // ===== Pengumuman =====
                    SectionTitle(
                      'Cerita perusahaan',
                      action: 'Semua',
                      onAction: () => goAnnouncements(context),
                    ),
                    ...app.announcements
                        .take(2)
                        .map((a) => _AnnouncementTile(a: a)),
                    const SizedBox(height: 6),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _push(BuildContext c, Widget page) =>
      Navigator.push(c, MaterialPageRoute(builder: (_) => page));

  /// 12.0 → "12", 12.5 → "12.5" (saldo cuti live bisa desimal).
  String _fmtHari(double v) =>
      v == v.round() ? v.round().toString() : v.toStringAsFixed(1);

  Widget _bellButton(BuildContext context, AppState app) {
    final unread = app.unreadCount;
    return GestureDetector(
      onTap: () => goNotifications(context),
      child: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Theme.of(context).brightness == Brightness.dark
                ? Colors.white.withValues(alpha: 0.08)
                : Colors.black.withValues(alpha: 0.06),
          ),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(
              Icons.notifications_none_rounded,
              size: 22,
              color: Theme.of(
                context,
              ).colorScheme.onSurface.withValues(alpha: 0.7),
            ),
            if (unread > 0)
              Positioned(
                top: 10,
                right: 10,
                child: Container(
                  padding: const EdgeInsets.all(3.5),
                  decoration: const BoxDecoration(
                    color: Color(0xFFE11D48),
                    shape: BoxShape.circle,
                  ),
                  constraints: const BoxConstraints(minWidth: 8, minHeight: 8),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Kartu presensi utama: gradasi hero + jam hidup + tombol satu-tap.
class _ClockCard extends StatefulWidget {
  final AppState app;
  final DateTime now;
  const _ClockCard({required this.app, required this.now});

  @override
  State<_ClockCard> createState() => _ClockCardState();
}

class _ClockCardState extends State<_ClockCard> {
  bool _busy = false;

  /// Clock-in/out — async di mode live; pesan error server → SnackBar.
  Future<void> _clock() async {
    if (_busy) return;
    final app = widget.app;
    setState(() => _busy = true);
    final err = !app.isClockedIn
        ? await app.clockIn()
        : !app.isClockedOut
        ? await app.clockOut()
        : null;
    if (!mounted) return;
    setState(() => _busy = false);
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err), behavior: SnackBarBehavior.floating),
      );
    }
  }

  Widget _sumChip(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: Colors.white.withValues(alpha: 0.9),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    final now = widget.now;
    final rec = app.recordToday();
    final clockedIn = app.isClockedIn;
    final clockedOut = app.isClockedOut;
    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';

    final status = clockedOut
        ? 'Hari ini sudah selesai — bagus! 🎉'
        : clockedIn
        ? 'Sedang bekerja — semangat!'
        : 'Kamu belum presensi hari ini';

    // Live: label jadwal hari ini dari backend (fallback teks demo).
    final shift = app.myShiftInfo;
    final shiftText = !app.isLive || shift == null
        ? 'Shift Reguler · 08.00–17.00'
        : (shift.timeIn != null && shift.timeOut != null
              ? '${shift.scheduleName ?? shift.dayTypeName ?? 'Jadwal'} · ${shift.timeIn!.replaceAll(':', '.')}–${shift.timeOut!.replaceAll(':', '.')}'
              : shift.label);
    final place = app.isLive
        ? (app.employee.office.trim().isNotEmpty && app.employee.office != '—'
              ? app.employee.office
              : 'Kantor Pusat')
        : 'Kantor Pusat';

    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: AppTheme.heroGradient,
        borderRadius: BorderRadius.circular(26),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF059669).withValues(alpha: 0.35),
            blurRadius: 26,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.wb_sunny_rounded,
                      size: 13,
                      color: Colors.white.withValues(alpha: 0.9),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      shiftText,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: Colors.white.withValues(alpha: 0.95),
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              Icon(
                Icons.location_on_rounded,
                size: 14,
                color: Colors.white.withValues(alpha: 0.8),
              ),
              const SizedBox(width: 3),
              Text(
                place,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.white.withValues(alpha: 0.85),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            timeStr,
            style: const TextStyle(
              fontSize: 44,
              fontWeight: FontWeight.w900,
              color: Colors.white,
              letterSpacing: -1.5,
              height: 1,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${hariID[now.weekday - 1]}, ${tanggalID(now)} · $status',
            style: TextStyle(
              fontSize: 12.5,
              color: Colors.white.withValues(alpha: 0.88),
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: _timelineChip(
                  'Masuk',
                  rec?.checkIn != null ? jamID(rec!.checkIn!) : '--.--',
                  active: clockedIn,
                ),
              ),
              Container(
                width: 28,
                height: 2,
                margin: const EdgeInsets.symmetric(horizontal: 8),
                color: Colors.white.withValues(alpha: 0.25),
              ),
              Expanded(
                child: _timelineChip(
                  'Pulang',
                  rec?.checkOut != null ? jamID(rec!.checkOut!) : '--.--',
                  active: clockedOut,
                ),
              ),
              const SizedBox(width: 14),
              GestureDetector(
                onTap: _busy ? null : _clock,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.easeOutBack,
                  width: 62,
                  height: 62,
                  decoration: BoxDecoration(
                    color: clockedOut
                        ? Colors.white.withValues(alpha: 0.18)
                        : AppTheme.accent,
                    shape: BoxShape.circle,
                    boxShadow: clockedOut
                        ? null
                        : [
                            BoxShadow(
                              color: AppTheme.accent.withValues(alpha: 0.5),
                              blurRadius: 14,
                              offset: const Offset(0, 6),
                            ),
                          ],
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.6,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          !clockedIn
                              ? Icons.play_arrow_rounded
                              : !clockedOut
                              ? Icons.stop_rounded
                              : Icons.check_rounded,
                          color: Colors.white,
                          size: 30,
                        ),
                ),
              ),
            ],
          ),
          if (app.isLive)
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: Row(
                children: [
                  _sumChip('Hadir ${app.kpi.present}'),
                  const SizedBox(width: 6),
                  _sumChip('Terlambat ${app.kpi.late}'),
                  const SizedBox(width: 6),
                  _sumChip('Absen ${app.kpi.absent}'),
                  const Spacer(),
                  Text(
                    'bulan ini',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Colors.white.withValues(alpha: 0.65),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _timelineChip(String label, String value, {required bool active}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: active ? 0.16 : 0.07),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: Colors.white.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: Colors.white.withValues(alpha: active ? 1 : 0.55),
              letterSpacing: -0.3,
            ),
          ),
        ],
      ),
    );
  }
}

/// Baris pengajuan terbaru di beranda (feed lintas modul).
/// Live: docNo + dateLabel dari dashboard; demo: seed MyRequest.
class _RecentRequestTile extends StatelessWidget {
  final MyRequest r;
  final bool live;
  const _RecentRequestTile({required this.r, required this.live});

  static const _kindLabel = {
    RequestKind.overtime: 'Lembur',
    RequestKind.workoff: 'Workoff',
    RequestKind.swap: 'Tukar Shift',
    RequestKind.travel: 'Perjalanan Dinas',
  };
  static const _kindIcon = {
    RequestKind.overtime: Icons.schedule_rounded,
    RequestKind.workoff: Icons.event_repeat_rounded,
    RequestKind.swap: Icons.swap_horiz_rounded,
    RequestKind.travel: Icons.flight_takeoff_rounded,
  };
  static const _kindColor = {
    RequestKind.overtime: Color(0xFFB45309),
    RequestKind.workoff: Color(0xFF0369A1),
    RequestKind.swap: Color(0xFF4F46E5),
    RequestKind.travel: Color(0xFF0E7490),
  };

  @override
  Widget build(BuildContext context) {
    final color = _kindColor[r.kind]!;
    final title = live && (r.docNo?.isNotEmpty ?? false) ? r.docNo! : r.title;
    final when = live
        ? (r.detail.trim().isNotEmpty ? r.detail.trim() : tanggalID(r.date))
        : tanggalID(r.date);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white.withValues(alpha: 0.06)
              : Colors.black.withValues(alpha: 0.05),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(_kindIcon[r.kind], color: color, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${_kindLabel[r.kind]} · $when',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    color: Theme.of(context).hintColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (!live && r.detail.trim().isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    r.detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context).hintColor,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusChip(r.status, compact: true),
        ],
      ),
    );
  }
}

class _PayslipTeaser extends StatelessWidget {
  final AppState app;
  const _PayslipTeaser({required this.app});

  @override
  Widget build(BuildContext context) {
    final latest = app.payslips.firstOrNull;
    if (latest == null) {
      // Live bisa saja belum ada slip — teaser merunduk dengan sopan.
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF1C2B26), Color(0xFF2A3F37)],
          ),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.payments_outlined,
              color: Color(0xFF6EE7B7),
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Slip gaji belum tersedia — kartu ini mengisi dirinya begitu payroll periode terakhirmu selesai diproses.',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.white.withValues(alpha: 0.72),
                  fontWeight: FontWeight.w600,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
      );
    }
    final periodLabel =
        (latest.periodName != null && latest.periodName!.trim().isNotEmpty)
        ? latest.periodName!.trim()
        : periodeID(latest.year, latest.month);
    final statusLabel = switch (latest.status?.toLowerCase()) {
      'paid' => 'Sudah dibayar',
      'confirmed' => 'Terkonfirmasi',
      _ => null,
    };
    // Live bisa tanpa nominal (privasi server) → tutup dengan "•••".
    final hideAmount = app.privacyMode || (app.isLive && latest.thp == 0);
    final footLine = app.isLive
        ? (latest.paidAt != null
              ? 'Dibayar ${tanggalID(latest.paidAt!)} — aman & terenkripsi 🔒'
              : 'Nominal terenkripsi & hanya bisa dibuka oleh kamu 🔒')
        : 'Terkirim tiap tanggal 28 — aman & terenkripsi 🔒';
    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const PayslipPage()),
      ),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF1C2B26), Color(0xFF2A3F37)],
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.25),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.payments_rounded,
                        color: Color(0xFF6EE7B7),
                        size: 18,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Take home $periodLabel',
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: Colors.white.withValues(alpha: 0.75),
                          ),
                        ),
                      ),
                      if (statusLabel != null)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(
                              0xFF6EE7B7,
                            ).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            statusLabel,
                            style: const TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF6EE7B7),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (hideAmount)
                    Text(
                      'Rp ••••••',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        letterSpacing: 1,
                      ),
                    )
                  else
                    MoneyText(
                      latest.thp,
                      privacy: app.privacyMode,
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        letterSpacing: -0.8,
                      ),
                    ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(
                        Icons.trending_up_rounded,
                        size: 14,
                        color: Colors.amber[300],
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          footLine,
                          style: TextStyle(
                            fontSize: 10.5,
                            color: Colors.white.withValues(alpha: 0.6),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Column(
              children: [
                IconButton(
                  onPressed: () => app.togglePrivacy(),
                  icon: Icon(
                    app.privacyMode
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                    color: Colors.white.withValues(alpha: 0.7),
                    size: 20,
                  ),
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white.withValues(alpha: 0.08),
                  ),
                ),
                const SizedBox(height: 6),
                Icon(
                  Icons.chevron_right_rounded,
                  color: Colors.white.withValues(alpha: 0.5),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _AnnouncementTile extends StatelessWidget {
  final dynamic a;
  const _AnnouncementTile({required this.a});

  static const catColors = {
    'Event': Color(0xFF7C3AED),
    'Payroll': Color(0xFF059669),
    'Pengembangan': Color(0xFF0369A1),
    'Kebijakan': Color(0xFFB45309),
    'Benefit': Color(0xFFDB2777),
  };

  @override
  Widget build(BuildContext context) {
    final color = catColors[a.category as String] ?? const Color(0xFF57534E);
    return GestureDetector(
      onTap: () => goAnnouncements(context),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: Theme.of(context).brightness == Brightness.dark
                ? Colors.white.withValues(alpha: 0.06)
                : Colors.black.withValues(alpha: 0.05),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(
                a.pinned ? Icons.push_pin_rounded : Icons.campaign_rounded,
                color: color,
                size: 19,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    a.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      height: 1.25,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${a.category} · ${relatif(a.publishedAt as DateTime)}',
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context).hintColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
