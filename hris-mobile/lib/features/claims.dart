import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Klaim medis & reimburse: filter status, form, timeline.
class ClaimsPage extends StatefulWidget {
  const ClaimsPage({super.key});

  @override
  State<ClaimsPage> createState() => _ClaimsPageState();
}

class _ClaimsPageState extends State<ClaimsPage> {
  String _filter = 'Semua';

  static const filters = ['Semua', 'Menunggu', 'Disetujui', 'Selesai', 'Ditolak'];

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final claims = app.claims.where((c) {
      if (_filter == 'Semua') return true;
      if (_filter == 'Menunggu') return c.status == 'pending' || c.status == 'submitted';
      if (_filter == 'Disetujui') return c.status == 'approved';
      if (_filter == 'Selesai') return c.status == 'done';
      return c.status == 'rejected';
    }).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Klaim Saya')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-claim',
        onPressed: () => _openForm(context),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Ajukan Klaim'),
      ),
      body: ListView(
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
                    app.claims.where((c) => c.status == 'approved' || c.status == 'done').map((c) => c.amount).fold(0, (a, b) => a + b),
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
                  color: const Color(0xFFDB2777).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.medical_services_rounded, color: Color(0xFFDB2777), size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.type, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(
                      '${c.provider} · ${tanggalID(c.date)}',
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
                  StatusChip(c.status, compact: true),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text('“${c.description}”', style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Theme.of(context).hintColor)),
          const Divider(height: 20),
          ApprovalTimeline(c.steps.map((s) => ApprovalStepMV(s.role, s.name, s.status)).toList()),
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

  @override
  void dispose() {
    _provider.dispose();
    _amount.dispose();
    _desc.dispose();
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
              Text(
                'Lampiran foto nota (ambil dari kamera) — hadir di versi berikutnya',
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor),
              ),
            ],
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: () {
              final amount = int.tryParse(_amount.text.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;
              if (_provider.text.trim().isEmpty || amount <= 0) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Lengkapi penyedia & nominal klaim dulu ya 🙂')),
                );
                return;
              }
              widget.app.submitClaim(
                type: _type,
                provider: _provider.text.trim(),
                amount: amount,
                desc: _desc.text.trim().isEmpty ? 'Klaim $_type' : _desc.text.trim(),
              );
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Klaim $_type ${rupiah(amount)} terkirim — semoga lekas membaik 🤗')),
              );
            },
            child: const Text('Kirim Klaim'),
          ),
        ],
      ),
    );
  }
}
