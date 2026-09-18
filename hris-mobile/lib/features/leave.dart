import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Cuti: saldo visual (ring per jenis) + pengajuan + riwayat ber-timeline.
class LeavePage extends StatelessWidget {
  const LeavePage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Cuti Saya')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-leave',
        onPressed: () => _openForm(context),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Ajukan Cuti'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
        children: [
          // ===== Saldo =====
          SizedBox(
            height: 128,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: app.leaveBalances.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (context, i) {
                final b = app.leaveBalances[i];
                final sisa = b.entitled - b.used;
                return Container(
                  width: 132,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: Theme.of(context).brightness == Brightness.dark
                          ? Colors.white.withValues(alpha: 0.06)
                          : Colors.black.withValues(alpha: 0.05),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        b.type.replaceFirst('Cuti ', ''),
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const Spacer(),
                      Row(
                        children: [
                          Ring(
                            progress: b.entitled == 0 ? 0 : b.used / b.entitled,
                            size: 52,
                            stroke: 5.5,
                            color: sisa > 0 ? Theme.of(context).colorScheme.primary : const Color(0xFFE11D48),
                            child: Text(
                              '$sisa',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Theme.of(context).colorScheme.primary),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'dari ${b.entitled}\nhari',
                              style: TextStyle(
                                fontSize: 10.5,
                                color: Theme.of(context).hintColor,
                                height: 1.35,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),

          // ===== Riwayat =====
          const SectionTitle('Riwayat Pengajuan'),
          if (app.leaves.isEmpty)
            const EmptyState(
              icon: Icons.beach_access_rounded,
              title: 'Belum ada pengajuan cuti',
              subtitle: 'Waktu healing juga penting — ajukan lewat tombol di bawah.',
            )
          else
            ...app.leaves.map((l) => _LeaveCard(l: l)),
        ],
      ),
    );
  }

  static void _openForm(BuildContext context) {
    final app = context.read<AppState>();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: _LeaveFormSheet(app: app),
      ),
    );
  }
}

class _LeaveCard extends StatelessWidget {
  final LeaveRequest l;
  const _LeaveCard({required this.l});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white.withValues(alpha: 0.06)
              : Colors.black.withValues(alpha: 0.05),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.beach_access_rounded, color: Color(0xFF059669), size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l.type, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(
                      l.from == l.to
                          ? '${tanggalID(l.from)} · ${l.days} hari'
                          : '${tanggalID(l.from)} – ${tanggalID(l.to)} · ${l.days} hari',
                      style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              StatusChip(l.status),
            ],
          ),
          const SizedBox(height: 10),
          Text('“${l.reason}”', style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Theme.of(context).hintColor)),
          const Divider(height: 22),
          ApprovalTimeline(
            l.steps.map((s) => ApprovalStepMV(s.role, s.name, s.status)).toList(),
          ),
        ],
      ),
    );
  }
}

class _LeaveFormSheet extends StatefulWidget {
  final AppState app;
  const _LeaveFormSheet({required this.app});

  @override
  State<_LeaveFormSheet> createState() => _LeaveFormSheetState();
}

class _LeaveFormSheetState extends State<_LeaveFormSheet> {
  String _type = 'Cuti Tahunan';
  DateTimeRange _range = DateTimeRange(
    start: DateTime.now().add(const Duration(days: 3)),
    end: DateTime.now().add(const Duration(days: 3)),
  );
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: now,
      lastDate: DateTime(now.year + 1),
      initialDateRange: _range,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          datePickerTheme: const DatePickerThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(24)))),
        ),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _range = picked);
  }

  @override
  Widget build(BuildContext context) {
    final days = _range.end.difference(_range.start).inDays + 1;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Ajukan Cuti', subtitle: 'Pilih jenis, tanggal, dan alasannya'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final b in widget.app.leaveBalances)
                ChoiceChip(
                  label: Text(b.type.replaceFirst('Cuti ', '')),
                  selected: _type == b.type,
                  onSelected: (_) => setState(() => _type = b.type),
                ),
            ],
          ),
          const SizedBox(height: 16),
          InkWell(
            onTap: _pickRange,
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
                      '${tanggalID(_range.start)} – ${tanggalID(_range.end)}',
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '$days hari',
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _reason,
            maxLines: 3,
            maxLength: 120,
            decoration: const InputDecoration(
              hintText: 'Alasan cuti (mis. liburan keluarga, acara penting…)',
            ),
          ),
          const SizedBox(height: 6),
          FilledButton(
            onPressed: () {
              if (_reason.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Tulis alasan cutimu dulu ya 🙂')),
                );
                return;
              }
              widget.app.submitLeave(type: _type, range: _range, reason: _reason.text.trim());
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Pengajuan $_type $days hari terkirim — pantau statusnya ✈️')),
              );
            },
            child: const Text('Kirim Pengajuan'),
          ),
        ],
      ),
    );
  }
}
