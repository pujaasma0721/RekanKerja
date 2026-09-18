import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Permintaan surat layanan dari HR.
class LettersPage extends StatelessWidget {
  const LettersPage({super.key});

  static const types = [
    ('Surat Keterangan Kerja', Icons.badge_rounded, Color(0xFF059669), 'Ukuran kerja & status kepegawaian'),
    ('Surat Keterangan Gaji', Icons.payments_rounded, Color(0xFF0369A1), 'Penghasilan bulanan (utk bank/visa)'),
    ('Surat Pengalaman Kerja', Icons.work_history_rounded, Color(0xFF7C3AED), 'Riwayat posisi & masa kerja'),
    ('Surat Rekomendasi', Icons.recommend_rounded, Color(0xFFB45309), 'Rekomendasi personal dari atasan'),
  ];

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Layanan Surat')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          const Text(
            'Surat resmi dibuat HR ±2 hari kerja — tanpa antre, tanpa form kertas.',
            style: TextStyle(fontSize: 12.5, height: 1.5),
          ),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.18,
            children: [
              for (final (name, icon, color, desc) in types)
                GestureDetector(
                  onTap: () => _openForm(context, name),
                  child: Container(
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
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [color.withValues(alpha: 0.18), color.withValues(alpha: 0.08)],
                            ),
                            borderRadius: BorderRadius.circular(13),
                          ),
                          child: Icon(icon, color: color, size: 20),
                        ),
                        const Spacer(),
                        Text(name, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, height: 1.2)),
                        const SizedBox(height: 4),
                        Text(
                          desc,
                          style: TextStyle(fontSize: 10, color: Theme.of(context).hintColor, height: 1.3),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),

          const SectionTitle('Riwayat Permintaan'),
          if (app.letters.isEmpty)
            const EmptyState(
              icon: Icons.mark_email_read_rounded,
              title: 'Belum ada permintaan surat',
              subtitle: 'Butuh surat keterangan utk KPR atau visa? Tinggal pilih di atas.',
            )
          else
            ...app.letters.map((l) => _LetterTile(l: l)),
        ],
      ),
    );
  }

  static void _openForm(BuildContext context, String type) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => _LetterSheet(type: type),
    );
  }
}

class _LetterTile extends StatelessWidget {
  final LetterRequest l;
  const _LetterTile({required this.l});

  @override
  Widget build(BuildContext context) {
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
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFF0369A1).withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.description_rounded, color: Color(0xFF0369A1), size: 19),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.type, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                const SizedBox(height: 2),
                Text(
                  '“${l.purpose}” · ${tanggalID(l.requestedAt)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          StatusChip(l.status, compact: true),
        ],
      ),
    );
  }
}

class _LetterSheet extends StatefulWidget {
  final String type;
  const _LetterSheet({required this.type});

  @override
  State<_LetterSheet> createState() => _LetterSheetState();
}

class _LetterSheetState extends State<_LetterSheet> {
  final _purpose = TextEditingController();

  @override
  void dispose() {
    _purpose.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SheetHeader('Ajukan ${widget.type}', subtitle: 'Keperluan surat akan tercantum di dokumen'),
            TextField(
              controller: _purpose,
              maxLines: 2,
              decoration: const InputDecoration(hintText: 'Mis. pengajuan KPR Bank BNI / visa turis'),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: () {
                if (_purpose.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Tuliskan keperluan suratnya dulu ya 🙂')),
                  );
                  return;
                }
                context.read<AppState>().submitLetter(type: widget.type, purpose: _purpose.text.trim());
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('${widget.type} diproses — siap ±2 hari kerja 📄')),
                );
              },
              child: const Text('Kirim Permintaan'),
            ),
          ],
        ),
      ),
    );
  }
}
