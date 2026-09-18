import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
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

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Aset Saya')),
      body: ListView(
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
                        '${app.assets.length} aset dipercayakan',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Colors.white),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Rawat ya — pengembalian diproses saat offboarding.',
                        style: TextStyle(fontSize: 11.5, color: Colors.white.withValues(alpha: 0.85)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ...app.assets.map((a) => _AssetTile(a: a)),
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
    );
  }
}

class _AssetTile extends StatelessWidget {
  final AssetItem a;
  const _AssetTile({required this.a});

  @override
  Widget build(BuildContext context) {
    final color = AssetsPage.catColors[a.category] ?? Colors.grey;
    final icon = AssetsPage.catIcons[a.category] ?? Icons.inventory_rounded;
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
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [color.withValues(alpha: 0.18), color.withValues(alpha: 0.08)],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: color, size: 21),
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
                  style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 5),
                Row(
                  children: [
                    Icon(Icons.calendar_today_rounded, size: 10, color: Theme.of(context).hintColor),
                    const SizedBox(width: 4),
                    Text(
                      'Sejak ${tanggalID(a.assignedAt)}',
                      style: TextStyle(fontSize: 10, color: Theme.of(context).hintColor),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
            child: Text(
              a.status,
              style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: color),
            ),
          ),
        ],
      ),
    );
  }
}
