import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import 'announcements.dart';
import 'assets.dart';
import 'attendance.dart';
import 'claims.dart';
import 'leave.dart';
import 'letters.dart';
import 'notifications.dart';
import 'requests.dart';
import 'swap.dart';

/// Tab "Saya": profil + hub seluruh fitur + pengaturan.
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final emp = app.employee;
    final scheme = Theme.of(context).colorScheme;
    final masaKerja = DateTime.now().difference(emp.joinDate);

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
        children: [
          const SizedBox(height: 56),

          // ===== Kartu identitas =====
          Row(
            children: [
              AppAvatar(emp.fullName, size: 72),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      emp.fullName,
                      style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900, letterSpacing: -0.4),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      emp.position,
                      style: TextStyle(fontSize: 12.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                          decoration: BoxDecoration(
                            color: scheme.primary.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            emp.employeeNo,
                            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: scheme.primary),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF059669).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: const Text(
                            'Aktif',
                            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: Color(0xFF059669)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () {},
                icon: const Icon(Icons.qr_code_2_rounded, size: 26),
                tooltip: 'Kartu digital karyawan',
              ),
            ],
          ),

          const SizedBox(height: 16),

          // ===== Kartu kepegawaian =====
          _kepegawaianCard(context, emp, masaKerja),

          const SectionTitle('Semua Layanan'),
          _menuGrid(context),

          const SectionTitle('Keluarga & Dokumen'),
          Row(
            children: [
              Expanded(
                child: _miniCard(
                  context,
                  Icons.family_restroom_rounded,
                  '${emp.family.length} anggota',
                  'Data keluarga terdaftar',
                  const Color(0xFFDB2777),
                  onTap: () => _showFamily(context, emp.family, scheme),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _miniCard(
                  context,
                  Icons.folder_rounded,
                  '${emp.documents.length} dokumen',
                  'KTP, KK, ijazah, NPWP',
                  const Color(0xFF0369A1),
                  onTap: () => _showDocs(context, emp.documents),
                ),
              ),
            ],
          ),

          const SectionTitle('Pengaturan'),
          _settingsCard(context, app),
          const SizedBox(height: 10),
          _logoutCard(context, app),
          const SizedBox(height: 20),
          Center(
            child: Text(
              'OneVity HRIS Mobile v1.0.0 (demo UI)\nDibuat dengan ❤️ untuk pekerja Indonesia',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, height: 1.6),
            ),
          ),
        ],
      ),
    );
  }

  Widget _kepegawaianCard(BuildContext context, emp, Duration masaKerja) {
    final years = (masaKerja.inDays / 365).floor();
    final months = ((masaKerja.inDays % 365) / 30).floor();
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1C2B26), Color(0xFF2A3F37)],
        ),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          Row(
            children: [
              _kv('Unit', emp.unit),
              _kv('Kantor', emp.office),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _kv('Grade', emp.grade),
              _kv('Status', emp.employmentStatus),
            ],
          ),
          const Divider(color: Colors.white24, height: 28),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ATASAN LANGSUNG',
                      style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.45), letterSpacing: 0.6),
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        AppAvatar(emp.manager, size: 26),
                        const SizedBox(width: 8),
                        Text(
                          emp.manager,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Colors.white),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    'MASA KERJA',
                    style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.45), letterSpacing: 0.6),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '$years th $months bln',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF6EE7B7)),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _kv(String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.45), letterSpacing: 0.6),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Colors.white),
          ),
        ],
      ),
    );
  }

  Widget _menuGrid(BuildContext context) {
    final items = [
      (Icons.beach_access_rounded, const Color(0xFF059669), 'Cuti', const LeavePage()),
      (Icons.fingerprint_rounded, const Color(0xFF0284C7), 'Presensi', const AttendancePage()),
      (Icons.medical_services_rounded, const Color(0xFFDB2777), 'Klaim', const ClaimsPage()),
      (Icons.assignment_rounded, const Color(0xFFB45309), 'Pengajuan', const RequestsPage()),
      (Icons.description_rounded, const Color(0xFF0369A1), 'Surat', const LettersPage()),
      (Icons.campaign_rounded, const Color(0xFF7C3AED), 'Pengumuman', const AnnouncementsPage()),
      (Icons.swap_horiz_rounded, const Color(0xFF4F46E5), 'Tukar Shift', const SwapPage()),
      (Icons.inventory_2_rounded, const Color(0xFF0E7490), 'Aset Saya', const AssetsPage()),
    ];
    return GridView.count(
      crossAxisCount: 4,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 0.92,
      children: [
        for (final (icon, color, label, page) in items)
          QuickAction(
            icon: icon,
            color: color,
            label: label,
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => page)),
          ),
      ],
    );
  }

  Widget _miniCard(BuildContext context, IconData icon, String value, String label, Color color, {VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, color: color, size: 19),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                  Text(label, style: TextStyle(fontSize: 10, color: Theme.of(context).hintColor)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _settingsCard(BuildContext context, AppState app) {
    return Container(
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
        children: [
          _switchRow(
            context,
            icon: Icons.dark_mode_rounded,
            color: const Color(0xFF4F46E5),
            label: 'Mode gelap',
            sub: 'Nyaman di mata saat lembur',
            value: app.themeMode == ThemeMode.dark,
            onChanged: (v) => app.setThemeMode(v ? ThemeMode.dark : ThemeMode.light),
          ),
          const Divider(indent: 56),
          _switchRow(
            context,
            icon: Icons.visibility_off_rounded,
            color: const Color(0xFF57534E),
            label: 'Sembunyikan nominal',
            sub: 'Privasi gaji di tempat umum',
            value: app.privacyMode,
            onChanged: (_) => app.togglePrivacy(),
          ),
          const Divider(indent: 56),
          ListTile(
            leading: Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(color: const Color(0xFF0369A1).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(11)),
              child: const Icon(Icons.notifications_rounded, size: 19, color: Color(0xFF0369A1)),
            ),
            title: const Text('Notifikasi', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
            subtitle: Text(app.unreadCount > 0 ? '${app.unreadCount} belum dibaca' : 'Semua sudah dibaca', style: const TextStyle(fontSize: 11)),
            trailing: const Icon(Icons.chevron_right_rounded, size: 20),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsPage())),
          ),
        ],
      ),
    );
  }

  Widget _switchRow(
    BuildContext context, {
    required IconData icon,
    required Color color,
    required String label,
    required String sub,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        children: [
          const SizedBox(width: 10),
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(11)),
            child: Icon(icon, size: 19, color: color),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
                Text(sub, style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }

  Widget _logoutCard(BuildContext context, AppState app) {
    return GestureDetector(
      onTap: () {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            title: const Text('Keluar dari aplikasi?'),
            content: const Text('Sampai jumpa lagi! Presensi & notifikasimu tetap aman.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
                onPressed: () {
                  Navigator.pop(ctx);
                  app.logout();
                },
                child: const Text('Keluar'),
              ),
            ],
          ),
        );
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFDC2626).withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFDC2626).withValues(alpha: 0.2)),
        ),
        child: Row(
          children: [
            const Icon(Icons.logout_rounded, color: Color(0xFFDC2626), size: 22),
            const SizedBox(width: 12),
            const Expanded(
              child: Text('Keluar', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Color(0xFFDC2626))),
            ),
            Icon(Icons.chevron_right_rounded, color: const Color(0xFFDC2626).withValues(alpha: 0.5)),
          ],
        ),
      ),
    );
  }

  void _showFamily(BuildContext context, List family, scheme) {
    showModalBottomSheet(
      context: context,
      builder: (_) => SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          shrinkWrap: true,
          children: [
            const SheetHeader('Data Keluarga', subtitle: 'Terkait tunjangan & PTKP'),
            ...family.map<Widget>((f) => Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
                  ),
                  child: Row(
                    children: [
                      AppAvatar(f.name, size: 40),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(f.name, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
                            Text(
                              f.relation,
                              style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        f.birthDate != null ? tanggalID(f.birthDate) : '—',
                        style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }

  void _showDocs(BuildContext context, List docs) {
    showModalBottomSheet(
      context: context,
      builder: (_) => SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          shrinkWrap: true,
          children: [
            const SheetHeader('Dokumen Saya', subtitle: 'Tersimpan aman di server OneVity'),
            ...docs.map<Widget>((d) => Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: const Color(0xFF0369A1).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(Icons.picture_as_pdf_rounded, size: 19, color: Color(0xFF0369A1)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(d.name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                            Text(
                              '${d.type} · diunggah ${tanggalID(d.uploadedAt)}',
                              style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.file_download_outlined, size: 20),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }
}
