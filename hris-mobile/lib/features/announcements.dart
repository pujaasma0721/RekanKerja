import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Feed pengumuman perusahaan.
class AnnouncementsPage extends StatelessWidget {
  const AnnouncementsPage({super.key});

  static const catColors = {
    'Event': Color(0xFF7C3AED),
    'Payroll': Color(0xFF059669),
    'Pengembangan': Color(0xFF0369A1),
    'Kebijakan': Color(0xFFB45309),
    'Benefit': Color(0xFFDB2777),
  };

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final items = [...app.announcements]..sort((a, b) => (b.pinned ? 1 : 0).compareTo(a.pinned ? 1 : 0));

    return Scaffold(
      appBar: AppBar(title: const Text('Pengumuman')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          if (items.isEmpty)
            const EmptyState(
              icon: Icons.campaign_rounded,
              title: 'Belum ada pengumuman',
              subtitle: 'Berita perusahaan akan muncul di sini.',
            )
          else
            ...items.map((a) => _AnnouncementCard(a: a)),
        ],
      ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  final Announcement a;
  const _AnnouncementCard({required this.a});

  @override
  Widget build(BuildContext context) {
    final color = AnnouncementsPage.catColors[a.category] ?? const Color(0xFF57534E);
    return GestureDetector(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AnnouncementDetailPage(a: a))),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
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
            if (a.pinned)
              Container(
                margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.push_pin_rounded, size: 10, color: color),
                    const SizedBox(width: 4),
                    Text('Disematkan', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: color)),
                  ],
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                        child: Text(
                          a.category,
                          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: color),
                        ),
                      ),
                      const Spacer(),
                      Text(
                        relatif(a.publishedAt),
                        style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    a.title,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, height: 1.3, letterSpacing: -0.2),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    a.body,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, height: 1.55, color: Theme.of(context).hintColor),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      AppAvatar(a.author, size: 26),
                      const SizedBox(width: 8),
                      Text(
                        a.author,
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                      const Spacer(),
                      Icon(Icons.chevron_right_rounded, size: 18, color: Theme.of(context).hintColor),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class AnnouncementDetailPage extends StatelessWidget {
  final Announcement a;
  const AnnouncementDetailPage({super.key, required this.a});

  @override
  Widget build(BuildContext context) {
    final color = AnnouncementsPage.catColors[a.category] ?? const Color(0xFF57534E);
    return Scaffold(
      appBar: AppBar(title: const Text('Pengumuman')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 100),
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Text(a.category, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: color)),
              ),
              const Spacer(),
              Text(tanggalID(a.publishedAt), style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            a.title,
            style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900, height: 1.25, letterSpacing: -0.5),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              AppAvatar(a.author, size: 34),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(a.author, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                  Text('Penulis pengumuman', style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 18),
          const Divider(),
          const SizedBox(height: 6),
          Text(
            a.body,
            style: TextStyle(fontSize: 14.5, height: 1.7, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.85)),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Terima kasih sudah membaca 🙌')),
              );
            },
            icon: const Icon(Icons.favorite_rounded, size: 17),
            label: const Text('Suka pengumuman ini'),
          ),
        ],
      ),
    );
  }
}
