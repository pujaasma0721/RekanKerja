import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Cuti: saldo visual (ring per jenis) + pengajuan + riwayat ber-timeline.

/// Format hari (live bisa pecahan, mis. 1,5 hari): 12 → "12", 1.5 → "1,5".
String _fmtHari(double v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1).replaceAll('.', ',');

/// Pesan INFO = fitur belum tersedia di mobile (bukan error teknis).
bool _isInfoMsg(String m) =>
    m.startsWith('Pengajuan dinas dari aplikasi mobile belum dibuka') ||
    m.startsWith('Pengajuan klaim baru dari aplikasi');

/// SnackBar hasil submit: INFO → amber + ikon info, error → merah.
/// Keduanya floating agar tidak menutupi form.
void _showResult(ScaffoldMessengerState messenger, String message) {
  final info = _isInfoMsg(message);
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: info ? const Color(0xFFB45309) : const Color(0xFFBE123C),
      duration: Duration(milliseconds: info ? 4500 : 3500),
      content: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(info ? Icons.info_rounded : Icons.error_outline_rounded, color: Colors.white, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12.5, height: 1.35),
            ),
          ),
        ],
      ),
    ),
  );
}

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
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
          children: [
            // ===== Saldo =====
            SizedBox(
              height: 128,
              child: app.leaveBalances.isEmpty
                  ? Center(
                      child: Text(
                        'Saldo cuti belum termuat — tarik ke bawah untuk memuat ulang.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor),
                      ),
                    )
                  : ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: app.leaveBalances.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 12),
                      itemBuilder: (context, i) {
                        final b = app.leaveBalances[i];
                        // Live: sisa dari getter (available, bisa pecahan mis. 1,5).
                        final sisa = b.sisa;
                        final usedPortion = b.entitled <= 0 ? 0.0 : (b.entitled - sisa) / b.entitled;
                        final unit = (b.unit ?? '').trim().toLowerCase();
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
                                    progress: usedPortion,
                                    size: 52,
                                    stroke: 5.5,
                                    color: sisa > 0 ? Theme.of(context).colorScheme.primary : const Color(0xFFE11D48),
                                    child: Text(
                                      _fmtHari(sisa),
                                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Theme.of(context).colorScheme.primary),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      'dari ${_fmtHari(b.entitled.toDouble())}\n${unit.isEmpty ? 'hari' : unit}',
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
    final dateLine = l.from == l.to
        ? '${tanggalID(l.from)} · ${l.days} hari'
        : '${tanggalID(l.from)} – ${tanggalID(l.to)} · ${l.days} hari';
    // Live: tampilkan nomor dokumen (docNo) di depan tanggal.
    final subtitle = (l.docNo == null || l.docNo!.isEmpty) ? dateLine : '${l.docNo} · $dateLine';
    final approver = (l.currentApprover ?? '').trim();
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
                      subtitle,
                      style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              StatusChip(l.status),
            ],
          ),
          if (l.reason.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text('“${l.reason}”', style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Theme.of(context).hintColor)),
          ],
          // Demo: timeline langkah lengkap. Live: daftar langkah belum tersedia —
          // tampilkan approver aktif saja bila ada.
          if (l.steps.isNotEmpty) ...[
            const Divider(height: 22),
            ApprovalTimeline(
              l.steps.map((s) => ApprovalStepMV(s.role, s.name, s.status)).toList(),
            ),
          ] else if (approver.isNotEmpty) ...[
            const Divider(height: 22),
            Row(
              children: [
                const Icon(Icons.schedule_rounded, size: 15, color: Color(0xFFB45309)),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Menunggu: $approver',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Theme.of(context).hintColor),
                  ),
                ),
              ],
            ),
          ],
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
  String _type = '';
  String? _typeId; // id jenis cuti live — wajib ikut dikirim saat submit
  DateTimeRange _range = DateTimeRange(
    start: DateTime.now().add(const Duration(days: 3)),
    end: DateTime.now().add(const Duration(days: 3)),
  );
  final _reason = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final list = widget.app.leaveBalances;
    if (list.isNotEmpty) {
      var pick = list.first;
      for (final b in list) {
        if (b.type == 'Cuti Tahunan') {
          pick = b;
          break;
        }
      }
      _type = pick.type;
      _typeId = pick.typeId;
    }
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  /// Jenis cuti yang sedang dipilih (dicocokkan via typeId live / nama).
  LeaveBalance? _selectedBalance() {
    final list = widget.app.leaveBalances;
    if (list.isEmpty) return null;
    for (final b in list) {
      final matches = _typeId != null ? b.typeId == _typeId : b.type == _type;
      if (matches) return b;
    }
    return list.first;
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

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    if (_reason.text.trim().isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Tulis alasan cutimu dulu ya 🙂')),
      );
      return;
    }
    final balance = _selectedBalance();
    if (balance == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Daftar jenis cuti belum termuat — tarik halaman Cuti untuk memuat ulang.')),
      );
      return;
    }
    setState(() => _busy = true);
    final days = _range.end.difference(_range.start).inDays + 1;
    final msg = await widget.app.submitLeave(
      type: balance.type,
      typeId: balance.typeId,
      range: _range,
      reason: _reason.text.trim(),
    );
    if (!mounted) return;
    if (msg == null) {
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(content: Text('Pengajuan ${balance.type} $days hari terkirim — pantau statusnya ✈️')),
      );
    } else {
      // error dari backend → sheet tetap terbuka agar bisa diperbaiki.
      setState(() => _busy = false);
      _showResult(messenger, msg);
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = _range.end.difference(_range.start).inDays + 1;
    final selected = _selectedBalance();
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Ajukan Cuti', subtitle: 'Pilih jenis, tanggal, dan alasannya'),
          if (widget.app.leaveBalances.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 8),
              child: Text(
                'Daftar jenis cuti belum termuat — tutup dulu, lalu tarik halaman Cuti ke bawah untuk memuat ulang.',
                style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor),
              ),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final b in widget.app.leaveBalances)
                  ChoiceChip(
                    label: Text(b.type.replaceFirst('Cuti ', '')),
                    selected: selected != null && (selected.typeId ?? selected.type) == (b.typeId ?? b.type),
                    onSelected: (_) => setState(() {
                      _type = b.type;
                      _typeId = b.typeId;
                    }),
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
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : const Text('Kirim Pengajuan'),
          ),
        ],
      ),
    );
  }
}
