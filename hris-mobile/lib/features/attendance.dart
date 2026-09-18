import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Presensi: kalender bulanan interaktif + ring statistik + riwayat.
class AttendancePage extends StatefulWidget {
  const AttendancePage({super.key});

  @override
  State<AttendancePage> createState() => _AttendancePageState();
}

class _AttendancePageState extends State<AttendancePage> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  DateTime? _selected;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final stats = app.monthStats(_month);
    final records = app.attendance
        .where((r) => r.date.year == _month.year && r.date.month == _month.month)
        .toList()
      ..sort((a, b) => b.date.compareTo(a.date));

    final selRecord = _selected == null
        ? null
        : app.attendance.where((r) => r.date == _selected).firstOrNull;

    return Scaffold(
      appBar: AppBar(title: Text('Presensi Saya')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          // ===== Ring statistik =====
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: AppTheme.heroGradient,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              children: [
                Ring(
                  progress: stats.hadir + stats.terlambat == 0
                      ? 0
                      : (stats.hadir + stats.terlambat) / _workdays(_month),
                  size: 92,
                  stroke: 9,
                  color: Colors.white,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${stats.hadir + stats.terlambat}',
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Colors.white, height: 1),
                      ),
                      Text(
                        '/ ${_workdays(_month)} hari',
                        style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.8)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 18),
                Expanded(
                  child: Column(
                    children: [
                      _miniStat(Icons.check_circle_rounded, '${stats.hadir} hari', 'Hadir tepat waktu', Colors.white),
                      const SizedBox(height: 8),
                      _miniStat(Icons.history_rounded, '${stats.terlambat} hari', 'Terlambat', Colors.white),
                      const SizedBox(height: 8),
                      _miniStat(Icons.local_fire_department_rounded, durasi(stats.lemburMenit), 'Total lembur', Colors.white),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ===== Kartu ringkasan kecil =====
          Row(
            children: [
              Expanded(child: StatTile(icon: Icons.event_busy_rounded, color: const Color(0xFF0369A1), value: '${stats.cuti} hari', label: 'Cuti')),
              const SizedBox(width: 10),
              Expanded(child: StatTile(icon: Icons.cancel_outlined, color: const Color(0xFFBE123C), value: '${stats.absen} hari', label: 'Tanpa keterangan')),
              const SizedBox(width: 10),
              Expanded(child: StatTile(icon: Icons.timelapse_rounded, color: const Color(0xFF7C3AED), value: durasi(stats.totalMenit), label: 'Total jam kerja')),
            ],
          ),

          // ===== Kalender =====
          const SectionTitle('Kalender Kehadiran'),
          _CalendarCard(
            month: _month,
            statusFor: (d) => app.attendance
                .where((r) => r.date == d)
                .firstOrNull
                ?.status,
            onSelected: (d) => setState(() => _selected = d),
            onPrev: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
            onNext: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
          ),

          // ===== Detail hari terpilih =====
          if (selRecord != null) ...[
            const SizedBox(height: 14),
            _DayDetailCard(rec: selRecord),
          ],

          // ===== Riwayat =====
          const SectionTitle('Riwayat Terbaru'),
          if (records.isEmpty)
            const EmptyState(
              icon: Icons.event_available_rounded,
              title: 'Belum ada data bulan ini',
              subtitle: 'Presensi akan muncul di sini setelah kamu mulai bekerja.',
            )
          else
            ...records.take(12).map((r) => _RecordTile(rec: r)),
        ],
      ),
    );
  }

  Widget _miniStat(IconData icon, String value, String label, Color color) {
    return Row(
      children: [
        Icon(icon, size: 15, color: color.withValues(alpha: 0.85)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Colors.white, height: 1)),
              Text(label, style: TextStyle(fontSize: 10, color: Colors.white.withValues(alpha: 0.7))),
            ],
          ),
        ),
      ],
    );
  }

  int _workdays(DateTime m) {
    // perkiraan hari kerja bulan berjalan s/d hari ini / penuh utk bulan lampau
    final now = DateTime.now();
    var last = DateTime(m.year, m.month + 1, 0);
    if (m.year == now.year && m.month == now.month) last = now;
    var count = 0;
    for (var d = DateTime(m.year, m.month, 1);
        d.isBefore(last.add(const Duration(days: 1)));
        d = d.add(const Duration(days: 1))) {
      if (d.weekday != DateTime.saturday && d.weekday != DateTime.sunday) count++;
    }
    return count;
  }
}

/// Kalender grid hand-rolled dengan titik status berwarna.
class _CalendarCard extends StatelessWidget {
  final DateTime month;
  final AttendanceStatus? Function(DateTime) statusFor;
  final ValueChanged<DateTime> onSelected;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  const _CalendarCard({
    required this.month,
    required this.statusFor,
    required this.onSelected,
    required this.onPrev,
    required this.onNext,
  });

  static const _dotColors = {
    AttendanceStatus.present: Color(0xFF059669),
    AttendanceStatus.late: Color(0xFFF59E0B),
    AttendanceStatus.leave: Color(0xFF0284C7),
    AttendanceStatus.absent: Color(0xFFE11D48),
    AttendanceStatus.holiday: Color(0xFF7C3AED),
  };

  @override
  Widget build(BuildContext context) {
    final first = DateTime(month.year, month.month, 1);
    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
    final leading = first.weekday - 1;
    final today = DateTime.now();
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white.withValues(alpha: 0.06)
              : Colors.black.withValues(alpha: 0.05),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(onPressed: onPrev, icon: const Icon(Icons.chevron_left_rounded, size: 24)),
              Expanded(
                child: Text(
                  periodeID(month.year, month.month),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(onPressed: onNext, icon: const Icon(Icons.chevron_right_rounded, size: 24)),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
                .map((d) => Expanded(
                      child: Center(
                        child: Text(
                          d,
                          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Theme.of(context).hintColor),
                        ),
                      ),
                    ))
                .toList(),
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7, mainAxisSpacing: 6),
            itemCount: leading + daysInMonth,
            itemBuilder: (context, i) {
              if (i < leading) return const SizedBox.shrink();
              final day = i - leading + 1;
              final date = DateTime(month.year, month.month, day);
              final isToday = date.year == today.year && date.month == today.month && date.day == today.day;
              final st = statusFor(date);
              final dot = _dotColors[st];
              final isWeekend = date.weekday == DateTime.saturday || date.weekday == DateTime.sunday;

              return GestureDetector(
                onTap: () => onSelected(date),
                child: Container(
                  decoration: BoxDecoration(
                    color: isToday ? scheme.primary : Colors.transparent,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '$day',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: isToday ? FontWeight.w900 : FontWeight.w600,
                          color: isToday
                              ? Colors.white
                              : isWeekend
                                  ? Theme.of(context).hintColor.withValues(alpha: 0.6)
                                  : null,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Container(
                        width: 5,
                        height: 5,
                        decoration: BoxDecoration(
                          color: dot ?? Colors.transparent,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 4,
            children: [
              for (final e in _dotColors.entries)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(width: 6, height: 6, decoration: BoxDecoration(color: e.value, shape: BoxShape.circle)),
                    const SizedBox(width: 4),
                    Text(
                      switch (e.key) {
                        AttendanceStatus.present => 'Hadir',
                        AttendanceStatus.late => 'Terlambat',
                        AttendanceStatus.leave => 'Cuti',
                        AttendanceStatus.absent => 'Absen',
                        AttendanceStatus.holiday => 'Libur',
                        _ => '',
                      },
                      style: TextStyle(fontSize: 9.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DayDetailCard extends StatelessWidget {
  final AttendanceRecord rec;
  const _DayDetailCard({required this.rec});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white.withValues(alpha: 0.06)
              : Colors.black.withValues(alpha: 0.05),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  tanggalID(rec.date, withDay: true),
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
                ),
              ),
              StatusChip(switch (rec.status) {
                AttendanceStatus.present => 'approved',
                AttendanceStatus.late => 'pending',
                AttendanceStatus.leave => 'submitted',
                AttendanceStatus.absent => 'rejected',
                _ => 'cancelled',
              }, compact: true),
            ],
          ),
          const Divider(height: 20),
          Row(
            children: [
              Expanded(child: InfoRow('Jam masuk', rec.checkIn != null ? jamID(rec.checkIn!) : '—', icon: Icons.login_rounded)),
              Expanded(child: InfoRow('Jam pulang', rec.checkOut != null ? jamID(rec.checkOut!) : '—', icon: Icons.logout_rounded)),
            ],
          ),
          if (rec.overtimeMinutes > 0)
            InfoRow('Lembur', durasi(rec.overtimeMinutes), icon: Icons.local_fire_department_rounded),
          if (rec.location != null) InfoRow('Lokasi', rec.location!, icon: Icons.location_on_outlined),
        ],
      ),
    );
  }
}

class _RecordTile extends StatelessWidget {
  final AttendanceRecord rec;
  const _RecordTile({required this.rec});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (color, label) = switch (rec.status) {
      AttendanceStatus.present => (const Color(0xFF059669), 'Hadir'),
      AttendanceStatus.late => (const Color(0xFFF59E0B), 'Terlambat'),
      AttendanceStatus.leave => (const Color(0xFF0284C7), 'Cuti'),
      AttendanceStatus.absent => (const Color(0xFFE11D48), 'Absen'),
      AttendanceStatus.holiday => (const Color(0xFF7C3AED), 'Libur'),
      AttendanceStatus.weekend => (Colors.grey, 'Akhir pekan'),
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white.withValues(alpha: 0.05)
              : Colors.black.withValues(alpha: 0.04),
        ),
      ),
      child: Row(
        children: [
          Column(
            children: [
              Text(
                '${rec.date.day}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, height: 1),
              ),
              Text(
                bulanID[rec.date.month - 1].substring(0, 3),
                style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: Theme.of(context).hintColor),
              ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  rec.checkIn != null
                      ? '${jamID(rec.checkIn!)} – ${rec.checkOut != null ? jamID(rec.checkOut!) : 'berjalan'}'
                      : label,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  rec.overtimeMinutes > 0 ? 'Lembur ${durasi(rec.overtimeMinutes)}' : (rec.location ?? '—'),
                  style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(999)),
            child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: color)),
          ),
        ],
      ),
    );
  }
}
