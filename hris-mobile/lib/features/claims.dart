import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Klaim medis & reimburse: filter status, form, timeline.

/// Pesan INFO = fitur belum tersedia di mobile (bukan error teknis).
bool _isInfoMsg(String m) =>
    m.startsWith('Pengajuan dinas dari aplikasi mobile belum dibuka') ||
    m.startsWith('Pengajuan klaim baru dari aplikasi');

/// SnackBar hasil submit: INFO → amber + ikon info, error → merah.
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

/// Status klaim live: beberapa status tambahan (mis. "settled") tidak ada di
/// StatusChip → chip netral abu-abu agar tidak terlihat seperti menunggu.
class _ClaimStatusChip extends StatelessWidget {
  final String status;
  final bool compact;
  const _ClaimStatusChip(this.status, {this.compact = false});

  static const extraLabels = {
    'settled': 'Selesai',
    'paid': 'Dibayar',
    'processed': 'Diproses',
    'processing': 'Diproses',
  };

  @override
  Widget build(BuildContext context) {
    if (StatusChip.labels.containsKey(status)) {
      return StatusChip(status, compact: compact);
    }
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 10, vertical: compact ? 3 : 5),
      decoration: BoxDecoration(
        color: dark ? Colors.white.withValues(alpha: 0.10) : const Color(0xFFF5F5F4),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        extraLabels[status] ?? status,
        style: TextStyle(
          fontSize: compact ? 10 : 11,
          fontWeight: FontWeight.w800,
          color: dark ? Colors.white70 : const Color(0xFF57534E),
        ),
      ),
    );
  }
}

class ClaimsPage extends StatefulWidget {
  const ClaimsPage({super.key});

  @override
  State<ClaimsPage> createState() => _ClaimsPageState();
}

class _ClaimsPageState extends State<ClaimsPage> {
  String _filter = 'Semua';

  static const filters = ['Semua', 'Menunggu', 'Disetujui', 'Selesai', 'Ditolak'];

  bool _inBucket(Claim c) {
    switch (_filter) {
      case 'Menunggu':
        return c.status == 'pending' || c.status == 'submitted';
      case 'Disetujui':
        return c.status == 'approved';
      case 'Selesai':
        return c.status == 'done' || c.status == 'settled';
      case 'Ditolak':
        return c.status == 'rejected';
      default:
        return true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final claims = app.claims.where(_inBucket).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Klaim Saya')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-claim',
        onPressed: () => _openForm(context),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Ajukan Klaim'),
      ),
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
          children: [
            // Ringkasan
            Row(
              children: [
                Expanded(
                  child: StatTile(
                    icon: Icons.hourglass_top_rounded,
                    color: const Color(0xFFB45309),
                    value: '${app.claims.where((c) => c.status == 'pending' || c.status == 'submitted').length}',
                    label: 'Diproses',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: StatTile(
                    icon: Icons.task_alt_rounded,
                    color: const Color(0xFF059669),
                    value: rupiah(
                      app.claims
                          .where((c) => const ['approved', 'done', 'settled'].contains(c.status))
                          .map((c) => c.approvedAmount ?? c.amount)
                          .fold(0, (a, b) => a + b),
                      withSymbol: false,
                    ),
                    label: 'Total terbayar',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: StatTile(
                    icon: Icons.spa_rounded,
                    color: const Color(0xFF7C3AED),
                    value: 'Rp 5 jt',
                    label: 'Sisa plafon klaim',
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
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: active ? Colors.white : null,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 14),

            if (claims.isEmpty)
              const EmptyState(
                icon: Icons.receipt_long_rounded,
                title: 'Belum ada klaim',
                subtitle: 'Sakit? Periksa gigi? Semua reimbursement medis bisa diajukan di sini.',
              )
            else
              ...claims.map((c) => _ClaimCard(c: c)),
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
        child: _ClaimFormSheet(app: app),
      ),
    );
  }
}

class _ClaimCard extends StatelessWidget {
  final Claim c;
  const _ClaimCard({required this.c});

  @override
  Widget build(BuildContext context) {
    // Live: docNo sebagai nomor dokumen, tanggal dari submittedAt,
    // klaim dinas punya varian kartu sendiri (uang muka + pertanggungjawaban).
    final live = c.docNo != null;
    final iconColor = c.isTravel ? const Color(0xFF0E7490) : const Color(0xFFDB2777);
    final meta = <String>[
      if (live) ...[
        if ((c.docNo ?? '').isNotEmpty) c.docNo!,
        if (c.submittedAt != null) tanggalID(c.submittedAt!),
      ] else ...[
        c.provider,
        tanggalID(c.date),
      ],
    ];
    final showDesc = c.description.isNotEmpty && c.description != c.type;

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
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  c.isTravel ? Icons.flight_takeoff_rounded : Icons.medical_services_rounded,
                  color: iconColor,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.type, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(
                      meta.join(' · '),
                      style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(rupiah(c.amount), style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, letterSpacing: -0.3)),
                  const SizedBox(height: 3),
                  _ClaimStatusChip(c.status, compact: true),
                ],
              ),
            ],
          ),
          if (showDesc) ...[
            const SizedBox(height: 10),
            Text('“${c.description}”', style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Theme.of(context).hintColor)),
          ],
          if (_hasAmountDetail) ...[
            const Divider(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  if (c.approvedAmount != null)
                    _amountRow(context, 'Disetujui', c.approvedAmount!, emphasize: true),
                  if (c.isTravel && c.advanceAmount != null)
                    _amountRow(context, 'Uang muka', c.advanceAmount!),
                  if (c.isTravel && c.settlementAmount != null)
                    _amountRow(context, 'Pertanggungjawaban', c.settlementAmount!),
                ],
              ),
            ),
          ],
          if (c.steps.isNotEmpty) ...[
            const Divider(height: 20),
            ApprovalTimeline(c.steps.map((s) => ApprovalStepMV(s.role, s.name, s.status)).toList()),
          ],
        ],
      ),
    );
  }

  bool get _hasAmountDetail =>
      c.approvedAmount != null ||
      (c.isTravel && (c.advanceAmount != null || c.settlementAmount != null));

  Widget _amountRow(BuildContext context, String label, int value, {bool emphasize = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
          ),
          const Spacer(),
          Text(
            rupiah(value),
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: emphasize ? FontWeight.w800 : FontWeight.w700,
              color: emphasize ? const Color(0xFF059669) : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _ClaimFormSheet extends StatefulWidget {
  final AppState app;
  const _ClaimFormSheet({required this.app});

  @override
  State<_ClaimFormSheet> createState() => _ClaimFormSheetState();
}

class _ClaimFormSheetState extends State<_ClaimFormSheet> {
  static const types = ['Rawat Jalan', 'Rawat Inap', 'Perawatan Gigi', 'Kacamata', 'Persalinan', 'Medical Check-up'];
  String _type = types.first;
  final _provider = TextEditingController();
  final _amount = TextEditingController();
  final _desc = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _provider.dispose();
    _amount.dispose();
    _desc.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    final amount = int.tryParse(_amount.text.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;
    if (_provider.text.trim().isEmpty || amount <= 0) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Lengkapi penyedia & nominal klaim dulu ya 🙂')),
      );
      return;
    }
    setState(() => _busy = true);
    // Live: backend ESS belum membuka pengajuan klaim dari mobile →
    // mengembalikan pesan INFO (amber), bukan error.
    final msg = await widget.app.submitClaim(
      type: _type,
      provider: _provider.text.trim(),
      amount: amount,
      desc: _desc.text.trim().isEmpty ? 'Klaim $_type' : _desc.text.trim(),
    );
    if (!mounted) return;
    if (msg == null) {
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(content: Text('Klaim $_type ${rupiah(amount)} terkirim — semoga lekas membaik 🤗')),
      );
    } else {
      setState(() => _busy = false);
      if (_isInfoMsg(msg)) Navigator.pop(context);
      _showResult(messenger, msg);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetHeader('Ajukan Klaim', subtitle: 'Reimbursement medis & kesehatan'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final t in types)
                ChoiceChip(
                  label: Text(t),
                  selected: _type == t,
                  onSelected: (_) => setState(() => _type = t),
                ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _provider,
            decoration: const InputDecoration(hintText: 'Nama klinik / rumah sakit / optik'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              hintText: 'Total biaya (Rp)',
              prefixText: 'Rp ',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _desc,
            maxLines: 2,
            decoration: const InputDecoration(hintText: 'Ringkasan tindakan / obat'),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Icon(Icons.attach_file_rounded, size: 16, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Lampiran foto nota (ambil dari kamera) — hadir di versi berikutnya',
                  style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : const Text('Kirim Klaim'),
          ),
        ],
      ),
    );
  }
}
