import 'package:flutter/material.dart';

import 'announcements.dart';
import 'assets.dart';
import 'attendance.dart';
import 'claims.dart';
import 'home.dart';
import 'leave.dart';
import 'letters.dart';
import 'notifications.dart';
import 'payslip.dart';
import 'profile.dart';
import 'requests.dart';
import 'swap.dart';
import 'whistleblow.dart';

/// Kerangka utama: bottom nav 4 tab + FAB aksi tengah.
/// Tab: Beranda · Presensi · [Ajukan] · Slip Gaji · Saya
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: const [
          HomePage(),
          AttendancePage(),
          SizedBox.shrink(),
          PayslipPage(),
          ProfilePage(),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        heroTag: 'fab-ajukan',
        onPressed: _openQuickCreate,
        tooltip: 'Ajukan',
        child: const Icon(Icons.add_rounded, size: 30),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      bottomNavigationBar: BottomAppBar(
        color: Theme.of(context).brightness == Brightness.dark
            ? const Color(0xFF121714)
            : Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        notchMargin: 8,
        shape: const CircularNotchedRectangle(),
        padding: EdgeInsets.zero,
        child: Row(
          children: [
            _navItem(0, Icons.cottage_rounded, 'Beranda'),
            _navItem(1, Icons.fingerprint_rounded, 'Presensi'),
            const SizedBox(width: 56),
            _navItem(3, Icons.receipt_long_rounded, 'Slip Gaji'),
            _navItem(4, Icons.person_rounded, 'Saya'),
          ],
        ),
      ),
    );
  }

  Widget _navItem(int idx, IconData icon, String label) {
    final active = _tab == idx;
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => setState(() => _tab = idx),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              decoration: BoxDecoration(
                color: active ? scheme.primary.withValues(alpha: 0.12) : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                icon,
                size: 23,
                color: active
                    ? scheme.primary
                    : dark
                        ? Colors.white38
                        : Colors.black38,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: active
                    ? scheme.primary
                    : dark
                        ? Colors.white38
                        : Colors.black38,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Buka sheet "Pengajuan Cepat" — semua aksi karyawan.
  void _openQuickCreate() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _QuickCreateSheet(),
    );
  }
}

class _QuickCreateSheet extends StatelessWidget {
  const _QuickCreateSheet();

  static const items = [
    (Icons.beach_access_rounded, Color(0xFF059669), 'Cuti', LeavePage()),
    (Icons.schedule_rounded, Color(0xFFB45309), 'Lembur', RequestsPage()),
    (Icons.medical_services_rounded, Color(0xFFBE123C), 'Klaim Medis', ClaimsPage()),
    (Icons.description_rounded, Color(0xFF0369A1), 'Surat', LettersPage()),
    (Icons.swap_horiz_rounded, Color(0xFF4F46E5), 'Tukar Shift', SwapPage()),
    (Icons.notification_important_rounded, Color(0xFFDC2626), 'Lapor Aman', WhistleblowPage()),
  ];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Mau ngapain hari ini? ✨', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(
              'Semua pengajuan karyawan dalam satu tempat',
              style: TextStyle(fontSize: 12.5, color: Theme.of(context).hintColor),
            ),
            const SizedBox(height: 18),
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.05,
              children: [
                for (final (icon, color, label, page) in items)
                  _sheetAction(context, icon, color, label, page),
              ],
            ),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  const Icon(Icons.auto_awesome_rounded, color: Color(0xFFB45309), size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Tips: pengajuan sebelum jam 15.00 biasanya lebih cepat disetujui.',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sheetAction(BuildContext context, IconData icon, Color color, String label, Widget page) {
    return GestureDetector(
      onTap: () {
        Navigator.pop(context);
        Navigator.push(context, MaterialPageRoute(builder: (_) => page));
      },
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: Theme.of(context).brightness == Brightness.dark
                ? Colors.white.withValues(alpha: 0.07)
                : Colors.black.withValues(alpha: 0.05),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [color.withValues(alpha: 0.18), color.withValues(alpha: 0.08)],
                ),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(icon, color: color, size: 23),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

/// Navigasi ke halaman util umum (dipakai lintas halaman).
void goNotifications(BuildContext context) =>
    Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsPage()));

void goAnnouncements(BuildContext context) =>
    Navigator.push(context, MaterialPageRoute(builder: (_) => const AnnouncementsPage()));

void goAssets(BuildContext context) =>
    Navigator.push(context, MaterialPageRoute(builder: (_) => const AssetsPage()));
