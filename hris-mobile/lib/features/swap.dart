import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

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
    final live = app.isLive;
    final upcoming = app.schedule.where((s) => !s.date.isBefore(DateTime.now())).take(10).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Tukar Shift')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-swap',
        onPressed: _openForm,
        icon: const Icon(Icons.swap_horiz_rounded),
        label: const Text('Tawarkan Tukar'),
      ),
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
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

            if (live) ...[
              const SectionTitle('Papan Tukar Shift'),
              _liveBoardEntry(context),
              const SectionTitle('Tawaran Tukar'),
              if (app.swaps.isEmpty)
                const EmptyState(
                  icon: Icons.swap_horizontal_circle_rounded,
                  title: 'Belum ada tawaran tukar',
                  subtitle: 'Butuh tukar jadwal? Ajukan lewat tombol di bawah.',
                )
              else
                ...app.swaps.map((s) => _liveSwapCard(context, s)),
            ] else ...[
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
          ],
        ),
      ),
    );
  }

  // ================= LIVE =================

  /// Pintasan ke papan tukar (jadwal + kandidat per tanggal) di sheet.
  Widget _liveBoardEntry(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: _openForm,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: scheme.primary.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: scheme.primary.withValues(alpha: 0.2)),
        ),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(Icons.event_note_rounded, size: 21, color: scheme.primary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Cek jadwal & rekan tersedia', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 3),
                  Text(
                    'Pilih tanggal, lihat shift kamu, lalu ajukan ke rekan yang jadwalnya cocok.',
                    style: TextStyle(fontSize: 11.5, height: 1.5, color: Theme.of(context).hintColor),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: Theme.of(context).hintColor),
          ],
        ),
      ),
    );
  }

  /// Kartu riwayat tukar shift dari backend (mine + toMe).
  Widget _liveSwapCard(BuildContext context, SwapOffer s) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final hint = Theme.of(context).hintColor;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: dark ? Colors.white.withValues(alpha: 0.06) : Colors.black.withValues(alpha: 0.05),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF4F46E5).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  (s.code == null || s.code!.isEmpty) ? 'TUKAR' : s.code!,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF4F46E5)),
                ),
              ),
              const Spacer(),
              StatusChip(s.status, compact: true),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              AppAvatar(s.colleague, size: 34),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(s.colleague, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
                    Text(
                      'Tukar shift · ${tanggalID(s.myDate, withDay: true)}',
                      style: TextStyle(fontSize: 11, color: hint, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _miniShift(context, 'Pengaju', s.myShift)),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 8),
                child: Icon(Icons.swap_horiz_rounded, size: 20, color: Color(0xFF4F46E5)),
              ),
              Expanded(child: _miniShift(context, 'Rekan tujuan', s.colleagueShift)),
            ],
          ),
          if (s.reason != null && s.reason!.trim().isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              '“${s.reason!.trim()}”',
              style: TextStyle(fontSize: 11.5, height: 1.5, fontStyle: FontStyle.italic, color: hint),
            ),
          ],
          if (s.decisionNote != null && s.decisionNote!.trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              'Catatan: ${s.decisionNote!.trim()}',
              style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFFB45309)),
            ),
          ],
          if (s.status == 'pending') ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => _confirmCancel(s),
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFFBE123C),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: const Size(0, 34),
                  textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
                icon: const Icon(Icons.close_rounded, size: 16),
                label: const Text('Batalkan pengajuan'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _miniShift(BuildContext context, String who, String shift) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            who.toUpperCase(),
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: 0.5, color: Theme.of(context).hintColor),
          ),
          const SizedBox(height: 3),
          Text(
            shift.isEmpty ? '—' : shift,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, height: 1.3),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmCancel(SwapOffer s) async {
    final app = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: const Text('Batalkan pengajuan tukar?'),
        content: Text(
          'Pengajuan tukar shift dengan ${s.colleague} pada ${tanggalID(s.myDate)} akan ditarik. Kamu bisa mengajukan ulang kapan saja.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Jangan')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFBE123C)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Ya, batalkan'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final err = await app.cancelSwap(s.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(err ?? 'Pengajuan tukar shift dibatalkan. Kamu bisa mengajukan ulang kapan saja 🙌')),
    );
  }

  // ================= DEMO (tata letak lama) =================

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
    final live = context.read<AppState>().isLive;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => live ? const _SwapSheetLive() : const _SwapSheetDemo(),
    );
  }
}

/// Field tanggal bersama utk sheet tukar shift.
Widget _swapDateField(BuildContext context, String label, DateTime value, ValueChanged<DateTime> onPick) {
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

// ================= SHEET LIVE =================

/// Form live: pilih tanggal → papan jadwal + kandidat dari backend →
/// pilih rekan → tulis alasan → kirim.
class _SwapSheetLive extends StatefulWidget {
  const _SwapSheetLive();

  @override
  State<_SwapSheetLive> createState() => _SwapSheetLiveState();
}

class _SwapSheetLiveState extends State<_SwapSheetLive> {
  DateTime _date = DateTime.now();
  SwapCandidate? _picked;
  final _reason = TextEditingController();
  bool _loading = false;
  bool _sending = false;
  String? _boardError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadBoard());
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _loadBoard() async {
    setState(() {
      _loading = true;
      _boardError = null;
    });
    final err = await context.read<AppState>().loadSwapBoard(_date);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _boardError = err;
      _picked = null;
    });
  }

  Future<void> _submit() async {
    final picked = _picked;
    final reason = _reason.text.trim();
    if (picked == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pilih rekan tujuan tukar shift dulu ya 🙂')),
      );
      return;
    }
    if (reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tuliskan alasannya dulu — dibaca rekan & atasan sebelum disetujui 🙏')),
      );
      return;
    }
    setState(() => _sending = true);
    final err = await context.read<AppState>().submitSwap(
          date: _date,
          targetId: picked.employeeId,
          reason: reason,
        );
    if (!mounted) return;
    if (err != null) {
      // Gagal — sheet tetap terbuka supaya pilihan & alasan tidak hilang.
      setState(() => _sending = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      return;
    }
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Tawaran tukar dikirim — tunggu respons rekan & atasan ya 🤝')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final my = app.myShiftInfo;
    final candidates = app.swapCandidates;
    final scheme = Theme.of(context).colorScheme;
    final hint = Theme.of(context).hintColor;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SheetHeader('Tawarkan Tukar Shift', subtitle: 'Pilih tanggal, cek jadwal, lalu pilih rekan'),
            _swapDateField(context, 'Tanggal yang ingin ditukar', _date, (d) {
              setState(() {
                _date = d;
                _picked = null;
              });
              _loadBoard();
            }),
            const SizedBox(height: 12),
            if (_loading)
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: scheme.primary.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.4),
                  ),
                ),
              )
            else ...[
              _myShiftCard(context, my),
              if (_boardError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    _boardError!,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFFBE123C)),
                  ),
                ),
              const SizedBox(height: 14),
              Text('Pilih rekan', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: hint)),
              const SizedBox(height: 8),
              if (candidates.isEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: Theme.of(context).brightness == Brightness.dark
                          ? Colors.white.withValues(alpha: 0.06)
                          : Colors.black.withValues(alpha: 0.05),
                    ),
                  ),
                  child: Column(
                    children: [
                      Icon(Icons.search_off_rounded, size: 26, color: hint),
                      const SizedBox(height: 8),
                      Text(
                        'Belum ada rekan yang bisa diajak tukar di tanggal ini.\nCoba pilih tanggal lain ya 🙂',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 11.5, height: 1.5, color: hint),
                      ),
                    ],
                  ),
                )
              else
                ...candidates.map((c) => _candidateTile(context, c)),
              const SizedBox(height: 14),
              TextField(
                controller: _reason,
                maxLines: 3,
                decoration: const InputDecoration(
                  hintText: 'Alasan tukar — mis. acara keluarga, kelas, kondisi kesehatan…',
                  helperText: 'Dibaca rekan & atasan sebelum disetujui',
                  counterStyle: TextStyle(fontSize: 10),
                ),
              ),
              const SizedBox(height: 14),
              FilledButton(
                onPressed: _sending ? null : _submit,
                child: _sending
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                      )
                    : const Text('Kirim Tawaran'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _myShiftCard(BuildContext context, SwapMyShift? my) {
    final scheme = Theme.of(context).colorScheme;
    String? jam(String? s) => (s == null || s.isEmpty) ? null : s.replaceAll(':', '.');
    final masuk = jam(my?.timeIn);
    final keluar = jam(my?.timeOut);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.primary.withValues(alpha: 0.18)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: scheme.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.schedule_rounded, size: 19, color: scheme.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Jadwal kamu', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Theme.of(context).hintColor)),
                const SizedBox(height: 3),
                Text(
                  my?.label ?? 'Tidak ada jadwal',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                ),
                if (masuk != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    '$masuk – ${keluar ?? '—'}',
                    style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: scheme.primary),
                  ),
                ],
                if (my?.clockingRequired == true) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Wajib presensi di tanggal ini',
                    style: TextStyle(fontSize: 10, color: Theme.of(context).hintColor),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _candidateTile(BuildContext context, SwapCandidate c) {
    final selected = _picked?.employeeId == c.employeeId;
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final hint = Theme.of(context).hintColor;
    final chip = c.timeLabel.isNotEmpty ? c.timeLabel : c.dayTypeName;
    return GestureDetector(
      onTap: () => setState(() => _picked = selected ? null : c),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? scheme.primary.withValues(alpha: 0.06) : scheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected
                ? scheme.primary.withValues(alpha: 0.45)
                : dark
                    ? Colors.white.withValues(alpha: 0.06)
                    : Colors.black.withValues(alpha: 0.05),
          ),
        ),
        child: Row(
          children: [
            AppAvatar(c.fullName, size: 40),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(c.fullName, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                      ),
                      if (selected) Icon(Icons.check_circle_rounded, size: 18, color: scheme.primary),
                    ],
                  ),
                  const SizedBox(height: 2),
                  if ((c.employeeNo.isNotEmpty || (c.unitName ?? '').isNotEmpty))
                    Text(
                      [
                        if (c.employeeNo.isNotEmpty) c.employeeNo,
                        if ((c.unitName ?? '').isNotEmpty) c.unitName!,
                      ].join(' · '),
                      style: TextStyle(fontSize: 10.5, color: hint, fontWeight: FontWeight.w600),
                    ),
                ],
              ),
            ),
            if (chip.isNotEmpty) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF059669).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  chip,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Color(0xFF059669)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ================= SHEET DEMO (perilaku lama) =================

class _SwapSheetDemo extends StatefulWidget {
  const _SwapSheetDemo();

  @override
  State<_SwapSheetDemo> createState() => _SwapSheetDemoState();
}

class _SwapSheetDemoState extends State<_SwapSheetDemo> {
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
          _swapDateField(
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
          _swapDateField(
            context,
            'Tanggal shift $_colleague',
            _theirDate,
            (d) => setState(() => _theirDate = d),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () {
              context.read<AppState>().submitSwap(
                    date: _myDate,
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
}
