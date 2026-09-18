import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
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

    return Scaffold(
      body: SafeArea(
        bottom: false,
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
                        style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w800, letterSpacing: -0.3),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${emp.position} · ${emp.unit}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
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
                    value: '${app.leaveBalances.first.entitled - app.leaveBalances.first.used} hari',
                    label: 'Sisa cuti tahunan',
                    onTap: () => _push(context, const LeavePage()),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: StatTile(
                    icon: Icons.local_fire_department_rounded,
                    color: const Color(0xFFB45309),
                    value: durasi(app.monthStats(DateTime(_now.year, _now.month)).lemburMenit),
                    label: 'Lembur bulan ini',
                    onTap: () => _push(context, const RequestsPage()),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: StatTile(
                    icon: Icons.pending_actions_rounded,
                    color: const Color(0xFFBE123C),
                    value: '${app.claims.where((c) => c.status == 'pending' || c.status == 'submitted').length} klaim',
                    label: 'Sedang jalan',
                    onTap: () => _push(context, const ClaimsPage()),
                  ),
                ),
              ],
            ),

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
                QuickAction(icon: Icons.beach_access_rounded, color: const Color(0xFF059669), label: 'Ajukan Cuti', onTap: () => _push(context, const LeavePage())),
                QuickAction(icon: Icons.schedule_rounded, color: const Color(0xFFB45309), label: 'Lembur', onTap: () => _push(context, const RequestsPage())),
                QuickAction(icon: Icons.medical_services_rounded, color: const Color(0xFFBE123C), label: 'Klaim', onTap: () => _push(context, const ClaimsPage())),
                QuickAction(icon: Icons.description_rounded, color: const Color(0xFF0369A1), label: 'Surat', onTap: () => _push(context, const LettersPage())),
              ],
            ),

            // ===== Slip gaji terakhir =====
            const SectionTitle('Kantong gaji 💸', action: 'Lihat semua', onAction: null),
            _PayslipTeaser(app: app),

            // ===== Pengumuman =====
            SectionTitle(
              'Cerita perusahaan',
              action: 'Semua',
              onAction: () => goAnnouncements(context),
            ),
            ...app.announcements.take(2).map((a) => _AnnouncementTile(a: a)),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  void _push(BuildContext c, Widget page) => Navigator.push(c, MaterialPageRoute(builder: (_) => page));

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
            Icon(Icons.notifications_none_rounded,
                size: 22, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7)),
            if (unread > 0)
              Positioned(
                top: 10,
                right: 10,
                child: Container(
                  padding: const EdgeInsets.all(3.5),
                  decoration: const BoxDecoration(color: Color(0xFFE11D48), shape: BoxShape.circle),
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
class _ClockCard extends StatelessWidget {
  final AppState app;
  final DateTime now;
  const _ClockCard({required this.app, required this.now});

  @override
  Widget build(BuildContext context) {
    final rec = app.recordToday();
    final clockedIn = rec?.checkIn != null;
    final clockedOut = rec?.checkOut != null;
    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';

    final status = clockedOut
        ? 'Hari ini sudah selesai — bagus! 🎉'
        : clockedIn
            ? 'Sedang bekerja — semangat!'
            : 'Kamu belum presensi hari ini';

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
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.wb_sunny_rounded, size: 13, color: Colors.white.withValues(alpha: 0.9)),
                    const SizedBox(width: 5),
                    Text(
                      'Shift Reguler · 08.00–17.00',
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
              Icon(Icons.location_on_rounded, size: 14, color: Colors.white.withValues(alpha: 0.8)),
              const SizedBox(width: 3),
              Text(
                'Kantor Pusat',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.85)),
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
              Container(width: 28, height: 2, margin: const EdgeInsets.symmetric(horizontal: 8), color: Colors.white.withValues(alpha: 0.25)),
              Expanded(
                child: _timelineChip(
                  'Pulang',
                  rec?.checkOut != null ? jamID(rec!.checkOut!) : '--.--',
                  active: clockedOut,
                ),
              ),
              const SizedBox(width: 14),
              GestureDetector(
                onTap: () {
                  if (!clockedIn) {
                    app.clockIn();
                  } else if (!clockedOut) {
                    app.clockOut();
                  }
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.easeOutBack,
                  width: 62,
                  height: 62,
                  decoration: BoxDecoration(
                    color: clockedOut ? Colors.white.withValues(alpha: 0.18) : AppTheme.accent,
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
                  child: Icon(
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
          Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.7))),
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

class _PayslipTeaser extends StatelessWidget {
  final AppState app;
  const _PayslipTeaser({required this.app});

  @override
  Widget build(BuildContext context) {
    final latest = app.payslips.first;
    return GestureDetector(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PayslipPage())),
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
                      const Icon(Icons.payments_rounded, color: Color(0xFF6EE7B7), size: 18),
                      const SizedBox(width: 6),
                      Text(
                        'Take home ${periodeID(latest.year, latest.month)}',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: Colors.white.withValues(alpha: 0.75),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
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
                      Icon(Icons.trending_up_rounded, size: 14, color: Colors.amber[300]),
                      const SizedBox(width: 4),
                      Text(
                        'Terkirim tiap tanggal 28 — aman & terenkripsi 🔒',
                        style: TextStyle(fontSize: 10.5, color: Colors.white.withValues(alpha: 0.6), fontWeight: FontWeight.w500),
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
                    app.privacyMode ? Icons.visibility_off_rounded : Icons.visibility_rounded,
                    color: Colors.white.withValues(alpha: 0.7),
                    size: 20,
                  ),
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white.withValues(alpha: 0.08),
                  ),
                ),
                const SizedBox(height: 6),
                Icon(Icons.chevron_right_rounded, color: Colors.white.withValues(alpha: 0.5)),
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
              child: Icon(a.pinned ? Icons.push_pin_rounded : Icons.campaign_rounded, color: color, size: 19),
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
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, height: 1.25),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${a.category} · ${relatif(a.publishedAt as DateTime)}',
                    style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
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
