import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Aset perusahaan yang dipinjamkan ke karyawan.
class AssetsPage extends StatelessWidget {
  const AssetsPage({super.key});

  static const catIcons = {
    'Elektronik': Icons.laptop_mac_rounded,
    'Aksesori': Icons.keyboard_rounded,
    'Akses': Icons.badge_rounded,
    'Merchandise': Icons.checkroom_rounded,
  };
  static const catColors = {
    'Elektronik': Color(0xFF059669),
    'Aksesori': Color(0xFF0369A1),
    'Akses': Color(0xFFB45309),
    'Merchandise': Color(0xFFDB2777),
  };

  /// Kondisi pengembalian dari backend → bahasa Indonesia.
  static const kondisiID = {'Good': 'Baik', 'Damaged': 'Rusak', 'Lost': 'Hilang'};

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    // Live: 'Dikembalikan' / returnedAt terisi → riwayat; sisanya aktif.
    final history = app.assets.where((a) => a.status == 'Dikembalikan' || a.returnedAt != null).toList();
    final active = app.assets.where((a) => a.status != 'Dikembalikan' && a.returnedAt == null).toList();
    final split = history.isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Aset Saya')),
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF0E7490), Color(0xFF0891B2)],
                ),
                borderRadius: BorderRadius.circular(22),
              ),
              child: Row(
                children: [
                  const Icon(Icons.inventory_2_rounded, size: 36, color: Colors.white),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          split ? '${active.length} aset sedang dipakai' : '${app.assets.length} aset dipercayakan',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Colors.white),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          split
                              ? '${history.length} sudah dikembalikan — terima kasih sudah merawat!'
                              : 'Rawat ya — pengembalian diproses saat offboarding.',
                          style: TextStyle(fontSize: 11.5, color: Colors.white.withValues(alpha: 0.85)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (app.assets.isEmpty)
              const EmptyState(
                icon: Icons.inventory_2_rounded,
                title: 'Belum ada aset',
                subtitle: 'Aset yang dipinjahkan perusahaan akan muncul di sini.',
              )
            else if (!split)
              ...active.map((a) => _AssetTile(a: a))
            else ...[
              const SectionTitle('Sedang Dipakai'),
              if (active.isEmpty)
                const EmptyState(
                  icon: Icons.task_alt_rounded,
                  title: 'Tidak ada aset aktif',
                  subtitle: 'Semua aset yang pernah dipinjamkan sudah kamu kembalikan.',
                )
              else
                ...active.map((a) => _AssetTile(a: a)),
              const SectionTitle('Riwayat Pengembalian'),
              ...history.map((a) => _AssetTile(a: a)),
            ],
            const SizedBox(height: 6),
            OutlinedButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Laporan kerusakan aset: hubungi IT Support via menu Lapor Aman / ticket IT 🛠️')),
                );
              },
              icon: const Icon(Icons.build_rounded, size: 17),
              label: const Text('Aset Bermasalah?'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AssetTile extends StatelessWidget {
  final AssetItem a;
  const _AssetTile({required this.a});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final catColor = AssetsPage.catColors[a.category] ?? Colors.grey;
    final icon = AssetsPage.catIcons[a.category] ?? Icons.inventory_rounded;
    final returned = a.status == 'Dikembalikan' || a.returnedAt != null;
    final statusColor = returned
        ? const Color(0xFF57534E)
        : a.status == 'Dipakai'
            ? const Color(0xFF059669)
            : catColor;
    final hint = Theme.of(context).hintColor;
    final chipTextStyle = TextStyle(fontSize: 10, color: hint, fontWeight: FontWeight.w600);
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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [statusColor.withValues(alpha: 0.18), statusColor.withValues(alpha: 0.08)],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: statusColor, size: 21),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(a.name, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
                const SizedBox(height: 3),
                Text(
                  '${a.code}${a.serial != '—' ? ' · SN ${a.serial}' : ''}',
                  style: TextStyle(fontSize: 10.5, color: hint, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 7),
                Wrap(
                  spacing: 6,
                  runSpacing: 5,
                  children: [
                    _miniChip(context, Icons.calendar_today_rounded, Text('Sejak ${tanggalID(a.assignedAt)}', style: chipTextStyle)),
                    if (a.dueAt != null)
                      _miniChip(
                        context,
                        Icons.event_available_rounded,
                        Text('Jatuh tempo ${tanggalID(a.dueAt!)}', style: chipTextStyle.copyWith(color: const Color(0xFFB45309), fontWeight: FontWeight.w800)),
                        tint: const Color(0xFFB45309),
                      ),
                    if (returned && a.returnedAt != null)
                      _miniChip(context, Icons.assignment_turned_in_rounded, Text('Dikembalikan ${tanggalID(a.returnedAt!)}', style: chipTextStyle)),
                    if (a.returnCondition != null && a.returnCondition!.isNotEmpty)
                      _miniChip(
                        context,
                        Icons.grading_rounded,
                        Text('Kondisi: ${AssetsPage.kondisiID[a.returnCondition] ?? a.returnCondition}', style: chipTextStyle),
                      ),
                    if (a.value != null)
                      _miniChip(
                        context,
                        Icons.sell_outlined,
                        MoneyText(a.value!, privacy: app.privacyMode, style: chipTextStyle.copyWith(fontWeight: FontWeight.w800)),
                      ),
                  ],
                ),
                if (a.notes != null && a.notes!.trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    '“${a.notes!.trim()}”',
                    style: TextStyle(fontSize: 10.5, fontStyle: FontStyle.italic, height: 1.45, color: hint),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
            child: Text(
              a.status,
              style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: statusColor),
            ),
          ),
        ],
      ),
    );
  }

  /// Chip info kecil di dalam tile aset.
  Widget _miniChip(BuildContext context, IconData icon, Widget label, {Color? tint}) {
    final hint = Theme.of(context).hintColor;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tint != null
            ? tint.withValues(alpha: 0.1)
            : dark
                ? Colors.white.withValues(alpha: 0.06)
                : Colors.black.withValues(alpha: 0.045),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10.5, color: tint ?? hint),
          const SizedBox(width: 4),
          label,
        ],
      ),
    );
  }
}
