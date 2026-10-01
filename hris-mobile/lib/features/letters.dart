import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/api_client.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Permintaan surat layanan dari HR.
/// Live: jenis surat & riwayat dari backend; surat terbit dapat diunduh PDF-nya.
class LettersPage extends StatelessWidget {
  const LettersPage({super.key});

  static const types = [
    ('Surat Keterangan Kerja', Icons.badge_rounded, Color(0xFF059669), 'Ukuran kerja & status kepegawaian'),
    ('Surat Keterangan Gaji', Icons.payments_rounded, Color(0xFF0369A1), 'Penghasilan bulanan (utk bank/visa)'),
    ('Surat Pengalaman Kerja', Icons.work_history_rounded, Color(0xFF7C3AED), 'Riwayat posisi & masa kerja'),
    ('Surat Rekomendasi', Icons.recommend_rounded, Color(0xFFB45309), 'Rekomendasi personal dari atasan'),
  ];

  /// Ikon warna template live — ditebak dari key/nama (mis. "salary-letter").
  static IconData _tplIcon(LetterTemplate t) {
    final s = '${t.key} ${t.name}'.toLowerCase();
    if (s.contains('gaji') || s.contains('salary') || s.contains('income')) return Icons.payments_rounded;
    if (s.contains('pengalaman') || s.contains('experience')) return Icons.work_history_rounded;
    if (s.contains('rekomendasi') || s.contains('recommend') || s.contains('referensi')) return Icons.recommend_rounded;
    if (s.contains('kerja') || s.contains('employ')) return Icons.badge_rounded;
    return Icons.description_rounded;
  }

  static Color _tplColor(LetterTemplate t) {
    final s = '${t.key} ${t.name}'.toLowerCase();
    if (s.contains('gaji') || s.contains('salary') || s.contains('income')) return const Color(0xFF0369A1);
    if (s.contains('pengalaman') || s.contains('experience')) return const Color(0xFF7C3AED);
    if (s.contains('rekomendasi') || s.contains('recommend') || s.contains('referensi')) return const Color(0xFFB45309);
    if (s.contains('kerja') || s.contains('employ')) return const Color(0xFF059669);
    return const Color(0xFF0F766E);
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    // Live: jenis surat dari server; demo: daftar bawaan.
    final options = app.isLive
        ? [
            for (final t in app.letterTemplates)
              (t.name, _tplIcon(t), _tplColor(t), t.description ?? 'Surat resmi diterbitkan HR', t.key),
          ]
        : [
            for (final (name, icon, color, desc) in types) (name, icon, color, desc, null as String?),
          ];
    return Scaffold(
      appBar: AppBar(title: const Text('Layanan Surat')),
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
          children: [
            const Text(
              'Surat resmi dibuat HR ±2 hari kerja — tanpa antre, tanpa form kertas.',
              style: TextStyle(fontSize: 12.5, height: 1.5),
            ),
            const SizedBox(height: 16),
            if (app.isLive && options.isEmpty)
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white.withValues(alpha: 0.06)
                        : Colors.black.withValues(alpha: 0.05),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(Icons.mark_email_read_rounded, size: 20, color: Theme.of(context).hintColor),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text(
                        'Daftar jenis surat belum termuat — tarik ke bawah untuk memuat ulang.',
                        style: TextStyle(fontSize: 12.5, height: 1.4),
                      ),
                    ),
                  ],
                ),
              )
            else
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.18,
                children: [
                  for (final (name, icon, color, desc, key) in options)
                    GestureDetector(
                      onTap: () => _openForm(context, name: name, templateKey: key),
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
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
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
      ),
    );
  }

  static void _openForm(BuildContext context, {required String name, String? templateKey}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => _LetterSheet(type: name, templateKey: templateKey),
    );
  }
}

/// Chip status surat: pending/approved/rejected/issued (+ submitted/done demo).
class _LetterStatusChip extends StatelessWidget {
  final String status;
  const _LetterStatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final s = status.toLowerCase();
    final (Color fg, Color bg, String label) = switch (s) {
      'pending' => (const Color(0xFFB45309), const Color(0xFFFEF3C7), 'Menunggu'),
      'approved' => (const Color(0xFF0F766E), const Color(0xFFCCFBF1), 'Disetujui'),
      'rejected' => (const Color(0xFFBE123C), const Color(0xFFFFE4E6), 'Ditolak'),
      'issued' => (const Color(0xFF059669), const Color(0xFFECFDF5), 'Terbit'),
      'submitted' => (const Color(0xFF0369A1), const Color(0xFFE0F2FE), 'Terkirim'),
      'done' => (const Color(0xFF4338CA), const Color(0xFFE0E7FF), 'Selesai'),
      _ => (const Color(0xFF57534E), const Color(0xFFF5F5F4), status),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: dark ? bg.withValues(alpha: 0.16) : bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: fg)),
    );
  }
}

class _LetterTile extends StatefulWidget {
  final LetterRequest l;
  const _LetterTile({required this.l});

  @override
  State<_LetterTile> createState() => _LetterTileState();
}

class _LetterTileState extends State<_LetterTile> {
  bool _downloading = false;

  LetterRequest get l => widget.l;

  Future<void> _downloadPdf() async {
    if (_downloading) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    try {
      final res = await context.read<AppState>().letterPdf(l.id);
      final dir = await getTemporaryDirectory();
      final raw = l.letterRefNo?.isNotEmpty == true
          ? l.letterRefNo!
          : (l.reqNo?.isNotEmpty == true ? l.reqNo! : l.id);
      // Amankan nama file (refNo bisa berisi "/" dsb).
      final safe = raw.replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-');
      final f = File('${dir.path}/Surat-$safe.pdf');
      await f.writeAsBytes(res.bodyBytes);
      await SharePlus.instance.share(
        ShareParams(files: [XFile(f.path)], text: 'Surat resmi RekanKerja'),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Gagal mengunduh PDF: ${e.message}')));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Gagal mengunduh PDF surat — coba beberapa saat lagi.')));
    }
    if (mounted) setState(() => _downloading = false);
  }

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    final issued = l.status == 'issued';
    final rejected = l.status == 'rejected';
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
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
                    if (l.reqNo != null && l.reqNo!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        'No. ${l.reqNo}',
                        style: TextStyle(fontSize: 10.5, color: hint, fontWeight: FontWeight.w700, letterSpacing: 0.2),
                      ),
                    ],
                    const SizedBox(height: 2),
                    Text(
                      '“${l.purpose}” · ${tanggalID(l.requestedAt)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11, color: hint, fontWeight: FontWeight.w600),
                    ),
                    if (issued && l.issuedAt != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        l.letterRefNo != null && l.letterRefNo!.isNotEmpty
                            ? 'Terbit ${tanggalID(l.issuedAt!)} · Ref ${l.letterRefNo}'
                            : 'Terbit ${tanggalID(l.issuedAt!)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Color(0xFF059669)),
                      ),
                    ],
                    if (rejected && l.rejectReason != null && l.rejectReason!.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        'Alasan: ${l.rejectReason}',
                        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: Color(0xFFBE123C)),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _LetterStatusChip(status: l.status),
            ],
          ),
          if (issued && l.id.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(38),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                ),
                onPressed: _downloading ? null : _downloadPdf,
                icon: _downloading
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.picture_as_pdf_rounded, size: 17),
                label: Text(_downloading ? 'Mengunduh…' : 'Unduh PDF'),
              ),
            ),
        ],
      ),
    );
  }
}

class _LetterSheet extends StatefulWidget {
  final String type;
  final String? templateKey;
  const _LetterSheet({required this.type, this.templateKey});

  @override
  State<_LetterSheet> createState() => _LetterSheetState();
}

class _LetterSheetState extends State<_LetterSheet> {
  final _purpose = TextEditingController();
  final _notes = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _purpose.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final purpose = _purpose.text.trim();
    if (purpose.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tuliskan keperluan suratnya dulu ya 🙂')),
      );
      return;
    }
    final notes = _notes.text.trim();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    final err = await context.read<AppState>().submitLetter(
          type: widget.type,
          templateKey: widget.templateKey,
          purpose: purpose,
          notes: notes.isEmpty ? null : notes,
        );
    if (!mounted) return;
    if (err != null) {
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(content: Text(err)));
      return;
    }
    Navigator.pop(context);
    messenger.showSnackBar(
      SnackBar(content: Text('${widget.type} diproses — siap ±2 hari kerja 📄')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final live = widget.templateKey != null;
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
              enabled: !_busy,
              decoration: const InputDecoration(hintText: 'Mis. pengajuan KPR Bank BNI / visa turis'),
            ),
            if (live) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _notes,
                maxLines: 2,
                enabled: !_busy,
                decoration: const InputDecoration(hintText: 'Catatan tambahan utk HR (opsional)'),
              ),
            ],
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _submit,
              icon: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                    )
                  : const Icon(Icons.send_rounded, size: 17),
              label: Text(_busy ? 'Mengirim…' : 'Kirim Permintaan'),
            ),
          ],
        ),
      ),
    );
  }
}
