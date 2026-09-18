import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';

/// Kanal pelaporan pelanggaran — jaminan anonimitas & keberanian bicara.
class WhistleblowPage extends StatefulWidget {
  const WhistleblowPage({super.key});

  @override
  State<WhistleblowPage> createState() => _WhistleblowPageState();
}

class _WhistleblowPageState extends State<WhistleblowPage> {
  bool _anonymous = true;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Lapor Aman')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          // Hero jaminan keamanan
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF7F1D1D), Color(0xFFB91C1C), Color(0xFFDC2626)],
              ),
              borderRadius: BorderRadius.circular(26),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(17)),
                  child: const Icon(Icons.shield_rounded, color: Colors.white, size: 27),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Suaramu berharga. Identitasmu terlindungi.',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white, height: 1.25),
                ),
                const SizedBox(height: 8),
                Text(
                  'Semua laporan diterima komite etik independen. Mode anonim tidak menyimpan nama, perangkat, maupun lokasi — bahkan tim IT tidak bisa melihatnya.',
                  style: TextStyle(fontSize: 12.5, height: 1.6, color: Colors.white.withValues(alpha: 0.88)),
                ),
              ],
            ),
          ),

          const SectionTitle('Kenapa melapor itu aman?'),
          _point(context, Icons.visibility_off_rounded, 'Tanpa jejak',
              'Laporan anonim diputus dari sesi login & alamat IP sebelum masuk antrean review.'),
          _point(context, Icons.diversity_3_rounded, 'Komite independen',
              'Ditinjau komite etik lintas fungsi — bukan atasan langsung pihak yang dilaporkan.'),
          _point(context, Icons.follow_the_signs_rounded, 'Ada tindak lanjut',
              'Setiap laporan dapat kode pelacakan; kamu bisa memantau progres investigasinya di bawah.'),

          const SectionTitle('Laporan Saya'),
          if (app.whistleblows.isEmpty)
            const EmptyState(
              icon: Icons.verified_user_rounded,
              title: 'Belum ada laporan',
              subtitle: 'Semoga tempat kerja selalu sehat. Bila ada yang janggal, laporkan di sini.',
            )
          else
            ...app.whistleblows.map((w) => Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(16),
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFFDC2626).withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              w.ticket,
                              style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: Color(0xFFDC2626)),
                            ),
                          ),
                          const Spacer(),
                          Text(
                            tanggalID(w.submittedAt),
                            style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(w.category, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text(
                        w.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, color: Theme.of(context).hintColor, height: 1.4),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          StatusChip(w.status == 'investigasi' ? 'pending' : w.status == 'selesai' ? 'done' : 'submitted', compact: true),
                          const SizedBox(width: 8),
                          Text(
                            w.status == 'submitted' ? 'Menunggu antri review' : w.status == 'investigasi' ? 'Sedang diinvestigasi' : 'Investigasi selesai',
                            style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ],
                  ),
                )),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-wb',
        onPressed: _openForm,
        icon: const Icon(Icons.notification_important_rounded),
        label: const Text('Buat Laporan'),
      ),
    );
  }

  Widget _point(BuildContext context, IconData icon, String title, String desc) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: const Color(0xFFDC2626).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 18, color: const Color(0xFFDC2626)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                const SizedBox(height: 2),
                Text(desc, style: TextStyle(fontSize: 11.5, height: 1.45, color: Theme.of(context).hintColor)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openForm() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
          child: _ReportSheet(anon: _anonymous, onAnon: (v) => setSheet(() => _anonymous = v)),
        ),
      ),
    );
  }
}

class _ReportSheet extends StatelessWidget {
  final bool anon;
  final ValueChanged<bool> onAnon;
  const _ReportSheet({required this.anon, required this.onAnon});

  static const categories = [
    'Kekerasan / Pelecehan',
    'Benturan Kepentingan',
    'Penipuan / Fraud',
    'Pelanggaran K3',
    'Pencemaran Nama Baik',
    'Lainnya',
  ];

  @override
  Widget build(BuildContext context) {
    String cat = categories.first;
    final desc = TextEditingController();
    return StatefulBuilder(
      builder: (context, setSheet) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SheetHeader('Buat Laporan', subtitle: 'Sampaikan dengan jujur — lapangan wajib diisi'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final c in categories)
                  ChoiceChip(
                    label: Text(c),
                    selected: cat == c,
                    onSelected: (_) => setSheet(() => cat = c),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: desc,
              maxLines: 5,
              decoration: const InputDecoration(
                hintText: 'Ceritakan kejadiannya: apa, kapan, di mana, siapa yang terlibat…',
              ),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: () => onAnon(!anon),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: anon ? const Color(0xFF059669).withValues(alpha: 0.07) : Theme.of(context).inputDecorationTheme.fillColor,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: anon ? const Color(0xFF059669) : Colors.transparent,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      anon ? Icons.check_circle_rounded : Icons.circle_outlined,
                      size: 21,
                      color: anon ? const Color(0xFF059669) : Theme.of(context).hintColor,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Kirim sebagai anonim', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                          Text(
                            'Identitas, perangkat, dan lokasi tidak direkam sama sekali.',
                            style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFDC2626),
                foregroundColor: Colors.white,
              ),
              onPressed: () {
                if (desc.text.trim().length < 20) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Tuliskan kronologi minimal 20 karakter agar bisa ditindaklanjuti ya 🙏')),
                  );
                  return;
                }
                context.read<AppState>().submitWhistleblow(category: cat, description: desc.text.trim(), anonymous: anon);
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Laporan terkirim. Terima kasih sudah berani bicara 🛡️')),
                );
              },
              child: const Text('Kirim Laporan'),
            ),
          ],
        ),
      ),
    );
  }
}
