import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Pengajuan lain: lembur, workoff, tukar shift, perjalanan dinas.
class RequestsPage extends StatefulWidget {
  const RequestsPage({super.key});

  @override
  State<RequestsPage> createState() => _RequestsPageState();
}

class _RequestsPageState extends State<RequestsPage> {
  String _filter = 'Semua';

  static const filters = ['Semua', 'Lembur', 'Workoff', 'Dinas', 'Tukar Shift'];
  static const kindLabel = {
    RequestKind.overtime: 'Lembur',
    RequestKind.workoff: 'Workoff',
    RequestKind.swap: 'Tukar Shift',
    RequestKind.travel: 'Perjalanan Dinas',
  };
  static const kindIcon = {
    RequestKind.overtime: Icons.schedule_rounded,
    RequestKind.workoff: Icons.event_repeat_rounded,
    RequestKind.swap: Icons.swap_horiz_rounded,
    RequestKind.travel: Icons.flight_takeoff_rounded,
  };
  static const kindColor = {
    RequestKind.overtime: Color(0xFFB45309),
    RequestKind.workoff: Color(0xFF0369A1),
    RequestKind.swap: Color(0xFF4F46E5),
    RequestKind.travel: Color(0xFF0E7490),
  };

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final list = app.requests.where((r) {
      if (_filter == 'Semua') return true;
      if (_filter == 'Lembur') return r.kind == RequestKind.overtime;
      if (_filter == 'Workoff') return r.kind == RequestKind.workoff;
      if (_filter == 'Dinas') return r.kind == RequestKind.travel;
      return r.kind == RequestKind.swap;
    }).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Semua Pengajuan')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          // Pintas aksi
          Row(
            children: [
              Expanded(
                child: QuickAction(
                  icon: Icons.schedule_rounded,
                  color: const Color(0xFFB45309),
                  label: 'Ajukan Lembur',
                  onTap: () => _overtimeForm(context),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: QuickAction(
                  icon: Icons.event_repeat_rounded,
                  color: const Color(0xFF0369A1),
                  label: 'Ajukan Workoff',
                  onTap: () => _workoffForm(context),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: QuickAction(
                  icon: Icons.flight_takeoff_rounded,
                  color: const Color(0xFF0E7490),
                  label: 'Perjalanan Dinas',
                  onTap: () => _travelForm(context),
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),
          SizedBox(
            height: 36,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final active = filters[i] == _filter;
                final scheme = Theme.of(context).colorScheme;
                return GestureDetector(
                  onTap: () => setState(() => _filter = filters[i]),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: active ? scheme.primary : scheme.surface,
                      borderRadius: BorderRadius.circular(999),
                      border: active ? null : Border.all(color: Colors.black.withValues(alpha: 0.08)),
                    ),
                    child: Text(
                      filters[i],
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: active ? Colors.white : null),
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 14),

          if (list.isEmpty)
            const EmptyState(
              icon: Icons.assignment_outlined,
              title: 'Tidak ada pengajuan',
              subtitle: 'Filter kosong — coba pilih kategori lain atau buat pengajuan baru.',
            )
          else
            ...list.map((r) => _RequestTile(r: r)),
        ],
      ),
    );
  }

  static void _overtimeForm(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _OvertimeSheet(),
    );
  }

  static void _workoffForm(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _WorkoffSheet(),
    );
  }

  static void _travelForm(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _TravelSheet(),
    );
  }
}

class _RequestTile extends StatelessWidget {
  final MyRequest r;
  const _RequestTile({required this.r});

  @override
  Widget build(BuildContext context) {
    final color = _RequestsPageState.kindColor[r.kind]!;
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
            child: Icon(_RequestsPageState.kindIcon[r.kind], color: color, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  '${_RequestsPageState.kindLabel[r.kind]} · ${tanggalID(r.date)}',
                  style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 3),
                Text(
                  r.detail,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor),
                ),
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

/// ====== Sheet lembur ======
class _OvertimeSheet extends StatefulWidget {
  const _OvertimeSheet();

  @override
  State<_OvertimeSheet> createState() => _OvertimeSheetState();
}

class _OvertimeSheetState extends State<_OvertimeSheet> {
  DateTime _date = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _start = const TimeOfDay(hour: 17, minute: 15);
  TimeOfDay _end = const TimeOfDay(hour: 20, minute: 15);
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now().subtract(const Duration(days: 30)),
      lastDate: DateTime.now().add(const Duration(days: 30)),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _pickTime(bool isStart) async {
    final t = await showTimePicker(context: context, initialTime: isStart ? _start : _end);
    if (t != null) {
      setState(() {
        if (isStart) {
          _start = t;
        } else {
          _end = t;
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final hours = ((_end.hour * 60 + _end.minute) - (_start.hour * 60 + _start.minute)) / 60.0;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Ajukan Lembur', subtitle: 'Lembur di luar jam kerja dihargai — upah atau workoff'),
          InkWell(
            onTap: _pickDate,
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
                  Expanded(child: Text(tanggalID(_date, withDay: true), style: const TextStyle(fontWeight: FontWeight.w700))),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InkWell(
                  onTap: () => _pickTime(true),
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: Theme.of(context).inputDecorationTheme.fillColor,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.login_rounded, size: 20),
                        const SizedBox(width: 10),
                        Text('Mulai ${jamID(_start)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InkWell(
                  onTap: () => _pickTime(false),
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: Theme.of(context).inputDecorationTheme.fillColor,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.logout_rounded, size: 20),
                        const SizedBox(width: 10),
                        Text('Selesai ${jamID(_end)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (hours > 0)
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                'Durasi ${hours.toStringAsFixed(1)} jam — estimasi upah ± ${rupiah((hours * 87500).round())}',
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.primary),
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            maxLines: 2,
            decoration: const InputDecoration(hintText: 'Alasan / pekerjaan yang dikerjakan'),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () {
              if (_reason.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Tulis dulu pekerjaan yang akan dikerjakan ya 🙂')),
                );
                return;
              }
              context.read<AppState>().submitOvertime(date: _date, start: _start, end: _end, reason: _reason.text.trim());
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Pengajuan lembur terkirim — tetap jaga kesehatan! ☕')),
              );
            },
            child: const Text('Kirim Pengajuan Lembur'),
          ),
        ],
      ),
    );
  }
}

/// ====== Sheet workoff ======
class _WorkoffSheet extends StatefulWidget {
  const _WorkoffSheet();

  @override
  State<_WorkoffSheet> createState() => _WorkoffSheetState();
}

class _WorkoffSheetState extends State<_WorkoffSheet> {
  DateTime _date = DateTime.now().add(const Duration(days: 2));
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Ajukan Workoff', subtitle: 'Kompensasi hari libur karena bekerja lembur/akhir pekan'),
          InkWell(
            onTap: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: _date,
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 90)),
              );
              if (d != null) setState(() => _date = d);
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
                  const Icon(Icons.event_available_rounded, size: 20),
                  const SizedBox(width: 10),
                  Expanded(child: Text(tanggalID(_date, withDay: true), style: const TextStyle(fontWeight: FontWeight.w700))),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            maxLines: 2,
            decoration: const InputDecoration(hintText: 'Referensi lembur (mis. sprint Sabtu 6 Sep)'),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () {
              if (_reason.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Sebutkan lembur yang dikompensasi ya 🙂')),
                );
                return;
              }
              context.read<AppState>().submitWorkoff(date: _date, reason: _reason.text.trim());
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Pengajuan workoff terkirim — istirahatmu berharga 😌')),
              );
            },
            child: const Text('Kirim Pengajuan Workoff'),
          ),
        ],
      ),
    );
  }
}

/// ====== Sheet perjalanan dinas ======
class _TravelSheet extends StatefulWidget {
  const _TravelSheet();

  @override
  State<_TravelSheet> createState() => _TravelSheetState();
}

class _TravelSheetState extends State<_TravelSheet> {
  DateTimeRange _range = DateTimeRange(
    start: DateTime.now().add(const Duration(days: 7)),
    end: DateTime.now().add(const Duration(days: 9)),
  );
  final _dest = TextEditingController();
  final _purpose = TextEditingController();

  @override
  void dispose() {
    _dest.dispose();
    _purpose.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Ajukan Perjalanan Dinas', subtitle: 'SPPD + uang muka otomatis dihitung finance'),
          TextField(
            controller: _dest,
            decoration: const InputDecoration(hintText: 'Kota tujuan (mis. Surabaya)'),
          ),
          const SizedBox(height: 12),
          InkWell(
            onTap: () async {
              final now = DateTime.now();
              final r = await showDateRangePicker(
                context: context,
                firstDate: now,
                lastDate: DateTime(now.year + 1),
                initialDateRange: _range,
              );
              if (r != null) setState(() => _range = r);
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
                  Expanded(
                    child: Text(
                      '${tanggalID(_range.start)} – ${tanggalID(_range.end)} (${_range.end.difference(_range.start).inDays + 1} hari)',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _purpose,
            maxLines: 2,
            decoration: const InputDecoration(hintText: 'Keperluan dinas (mis. audit TI cabang)'),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () {
              if (_dest.text.trim().isEmpty || _purpose.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Lengkapi tujuan & keperluan dinas ya 🙂')),
                );
                return;
              }
              context.read<AppState>().submitTravel(
                    range: _range,
                    destination: _dest.text.trim(),
                    purpose: _purpose.text.trim(),
                  );
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Pengajuan dinas terkirim — jangan lupa bon-nya ya! ✈️')),
              );
            },
            child: const Text('Kirim Pengajuan Dinas'),
          ),
        ],
      ),
    );
  }
}
