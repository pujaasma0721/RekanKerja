import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';

/// Pusat notifikasi.
class NotificationsPage extends StatelessWidget {
  const NotificationsPage({super.key});

  static const kindSpec = {
    'attendance': (Icons.fingerprint_rounded, Color(0xFF059669)),
    'payslip': (Icons.payments_rounded, Color(0xFF1C2B26)),
    'claim': (Icons.medical_services_rounded, Color(0xFFDB2777)),
    'leave': (Icons.beach_access_rounded, Color(0xFF0284C7)),
    'request': (Icons.assignment_rounded, Color(0xFFB45309)),
    'swap': (Icons.swap_horiz_rounded, Color(0xFF4F46E5)),
    'letter': (Icons.description_rounded, Color(0xFF0369A1)),
    'whistleblow': (Icons.shield_rounded, Color(0xFFDC2626)),
    'gamification': (Icons.emoji_events_rounded, Color(0xFFF59E0B)),
    // Item dari backend live (ES OneVity).
    'system': (Icons.notifications_active_rounded, Color(0xFF0891B2)),
  };

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifikasi'),
        actions: [
          if (app.unreadCount > 0)
            TextButton(
              // markAllRead async — optimistic, tampilan langsung berubah.
              onPressed: () async {
                await app.markAllRead();
              },
              child: const Text('Tandai dibaca', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            ),
        ],
      ),
      body: app.notifications.isEmpty
          ? const EmptyState(
              icon: Icons.notifications_off_rounded,
              title: 'Tenang, belum ada apa-apa',
              subtitle: 'Kabar persetujuan & info penting akan muncul di sini.',
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
              itemCount: app.notifications.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final n = app.notifications[i];
                // Kind tak dikenal (mis. jenis baru dari backend) → bel netral.
                final (icon, color) = kindSpec[n.kind] ??
                    (Icons.notifications_rounded, const Color(0xFF57534E));
                return _NotifTile(
                  icon: icon,
                  color: color,
                  title: n.title,
                  body: n.body,
                  time: relatif(n.at),
                  read: n.read,
                  onTap: () async {
                    // markRead async — optimistic di AppState, UI instan.
                    await app.markRead(n);
                  },
                );
              },
            ),
    );
  }
}

class _NotifTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String body;
  final String time;
  final bool read;
  final VoidCallback onTap;

  const _NotifTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.body,
    required this.time,
    required this.read,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: read ? scheme.surface : scheme.primary.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: read
                ? dark
                    ? Colors.white.withValues(alpha: 0.05)
                    : Colors.black.withValues(alpha: 0.05)
                : scheme.primary.withValues(alpha: 0.25),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, size: 19, color: color == const Color(0xFF1C2B26) ? const Color(0xFF6EE7B7) : color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: read ? null : scheme.primary),
                        ),
                      ),
                      if (!read)
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(left: 6, top: 4),
                          decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    body,
                    style: TextStyle(fontSize: 12, height: 1.45, color: Theme.of(context).hintColor),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    time,
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Theme.of(context).hintColor),
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
