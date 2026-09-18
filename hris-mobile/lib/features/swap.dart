import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';

/// Tukar shift dengan rekan satu tim.
class SwapPage extends StatefulWidget {
  const SwapPage({super.key});

  @override
  State<SwapPage> createState() => _SwapPageState();
}

class _SwapPageState extends State<SwapPage> {
  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final upcoming = app.schedule.where((s) => !s.date.isBefore(DateTime.now())).take(10).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Tukar Shift')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-swap',
        onPressed: _openForm,
        icon: const Icon(Icons.swap_horiz_rounded),
        label: const Text('Tawarkan Tukar'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF4F46E5).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                const Icon(Icons.lightbulb_rounded, color: Color(0xFF4F46E5), size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Kedua pihak harus setuju + persetujuan atasan sebelum tukar shift aktif. Tetap ramah saat menawarkan ya 🤝',
                    style: TextStyle(fontSize: 11.5, height: 1.5, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.75)),
                  ),
                ),
              ],
            ),
          ),

          const SectionTitle('Shift Kamu ke Depan'),
          ...upcoming.map((s) => _scheduleTile(s.date, s.shift, s.time)),

          const SectionTitle('Tawaran Tukar'),
          if (app.swaps.isEmpty)
            const EmptyState(
              icon: Icons.swap_horizontal_circle_rounded,
              title: 'Belum ada tawaran tukar',
              subtitle: 'Butuh tukar jadwal? Ajukan lewat tombol di bawah.',
            )
          else
            ...app.swaps.map((s) => Container(
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
                  child: Column(
                    children: [
                      Row(
                        children: [
                          _shiftBox(context, 'Kamu', tanggalID(s.myDate), s.myShift, Theme.of(context).colorScheme.primary),
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 10),
                            child: Icon(Icons.swap_horiz_rounded, size: 22, color: Color(0xFF4F46E5)),
                          ),
                          _shiftBox(context, s.colleague, tanggalID(s.colleagueDate), s.colleagueShift, const Color(0xFF4F46E5)),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          AppAvatar(s.colleague, size: 24),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Menunggu respons ${s.colleague}',
                              style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                            ),
                          ),
                          StatusChip(s.status, compact: true),
                        ],
                      ),
                    ],
                  ),
                )),
        ],
      ),
    );
  }

  Widget _shiftBox(BuildContext context, String who, String date, String shift, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(who, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: color)),
            const SizedBox(height: 3),
            Text(date, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(shift, style: TextStyle(fontSize: 10, color: Theme.of(context).hintColor)),
          ],
        ),
      ),
    );
  }

  Widget _scheduleTile(DateTime date, String shift, String time) {
    final isToday = date.year == DateTime.now().year && date.month == DateTime.now().month && date.day == DateTime.now().day;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isToday ? scheme.primary.withValues(alpha: 0.07) : scheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isToday
              ? scheme.primary.withValues(alpha: 0.3)
              : Theme.of(context).brightness == Brightness.dark
                  ? Colors.white.withValues(alpha: 0.05)
                  : Colors.black.withValues(alpha: 0.04),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            child: Column(
              children: [
                Text(hariID[date.weekday - 1].substring(0, 3).toUpperCase(),
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Theme.of(context).hintColor)),
                Text('${date.day}',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, height: 1.05, color: isToday ? scheme.primary : null)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              shift == 'Libur' ? 'Libur — pulihkan energi 😴' : '$shift · $time',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: shift == 'Libur' ? Theme.of(context).hintColor : null),
            ),
          ),
          if (shift != 'Libur')
            GestureDetector(
              onTap: _openForm,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFF4F46E5).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text('Tukar', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF4F46E5))),
              ),
            ),
        ],
      ),
    );
  }

  void _openForm() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _SwapSheet(),
    );
  }
}

class _SwapSheet extends StatefulWidget {
  const _SwapSheet();

  @override
  State<_SwapSheet> createState() => _SwapSheetState();
}

class _SwapSheetState extends State<_SwapSheet> {
  static const colleagues = ['Dewi Lestari', 'Bagus Setiawan', 'Ayu Prameswari', 'Fajar Nugroho'];
  String _colleague = colleagues.first;
  DateTime _myDate = DateTime.now().add(const Duration(days: 3));
  DateTime _theirDate = DateTime.now().add(const Duration(days: 4));

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Tawarkan Tukar Shift', subtitle: 'Pilih tanggalmu & rekan yang dituju'),
          _dateField(
            context,
            'Tanggal shift kamu',
            _myDate,
            (d) => setState(() => _myDate = d),
          ),
          const SizedBox(height: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Rekan yang dituju', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Theme.of(context).hintColor)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in colleagues)
                    ChoiceChip(
                      avatar: AppAvatar(c, size: 20),
                      label: Text(c.split(' ').first),
                      selected: _colleague == c,
                      onSelected: (_) => setState(() => _colleague = c),
                    ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          _dateField(
            context,
            'Tanggal shift $_colleague',
            _theirDate,
            (d) => setState(() => _theirDate = d),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () {
              context.read<AppState>().submitSwap(
                    myDate: _myDate,
                    colleague: _colleague,
                    colleagueDate: _theirDate,
                    reason: 'Tukar jadwal',
                  );
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Tawaran tukar dikirim ke $_colleague — tunggu responsnya ya 🤝')),
              );
            },
            child: const Text('Kirim Tawaran'),
          ),
        ],
      ),
    );
  }

  Widget _dateField(BuildContext context, String label, DateTime value, ValueChanged<DateTime> onPick) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Theme.of(context).hintColor)),
        const SizedBox(height: 6),
        InkWell(
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: value,
              firstDate: DateTime.now(),
              lastDate: DateTime.now().add(const Duration(days: 60)),
            );
            if (d != null) onPick(d);
          },
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: Theme.of(context).inputDecorationTheme.fillColor,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(Icons.date_range_rounded, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(tanggalID(value, withDay: true), style: const TextStyle(fontWeight: FontWeight.w700))),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
