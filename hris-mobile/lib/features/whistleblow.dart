import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';
import '../data/rekankerja_api.dart';

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
    // Live: hanya tampilkan laporan yang benar-benar dikirim dari aplikasi ini
    // (seed demo tidak ikut tampil saat terhubung ke server).
    final items =
        app.isLive ? app.whistleblows.where((w) => _isFromThisApp(w)).toList() : app.whistleblows;

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
          if (items.isEmpty)
            const EmptyState(
              icon: Icons.verified_user_rounded,
              title: 'Belum ada laporan',
              subtitle: 'Semoga tempat kerja selalu sehat. Bila ada yang janggal, laporkan di sini.',
            )
          else
            ...items.map((w) => Container(
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

  /// Laporan yang dikirim aplikasi ini memakai nomor urut lokal AppState
  /// (_nextId, mulai dari 100); seed demo memakai id "WB-01" dst — jadi di
  /// mode live cukup tampilkan yang nomornya ≥ 100.
  static bool _isFromThisApp(WhistleblowReport w) =>
      (int.tryParse(w.id.split('-').last) ?? 0) >= 100;

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
      builder: (_) => _ReportSheet(
        initialAnon: _anonymous,
        onAnonChanged: (v) => _anonymous = v,
      ),
    );
  }
}

class _ReportSheet extends StatefulWidget {
  final bool initialAnon;
  final ValueChanged<bool> onAnonChanged;
  const _ReportSheet({required this.initialAnon, required this.onAnonChanged});

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  late bool _anon = widget.initialAnon;
  String? _catCode;
  final _desc = TextEditingController();
  final _location = TextEditingController();
  final _contact = TextEditingController();
  DateTime? _incidentDate;
  bool _sending = false;

  @override
  void dispose() {
    _desc.dispose();
    _location.dispose();
    _contact.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _catCode;
    final label = code == null ? '' : (RekanKerjaApi.wbCategories[code] ?? code);
    final desc = _desc.text.trim();
    if (code == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pilih kategori yang paling mendekati kejadiannya ya 🙏')),
      );
      return;
    }
    if (desc.length < 20) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tuliskan kronologi minimal 20 karakter agar bisa ditindaklanjuti ya 🙏')),
      );
      return;
    }
    if (_incidentDate != null && _incidentDate!.isAfter(DateTime.now())) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tanggal kejadian tidak boleh di masa depan.')),
      );
      return;
    }
    setState(() => _sending = true);
    final err = await context.read<AppState>().submitWhistleblow(
          category: label,
          categoryCode: code,
          description: desc,
          anonymous: _anon,
          incidentDate: _incidentDate,
          contact: _anon || _contact.text.trim().isEmpty ? null : _contact.text.trim(),
          location: _location.text.trim().isEmpty ? null : _location.text.trim(),
        );
    if (!mounted) return;
    if (err != null) {
      // Gagal — sheet tetap terbuka supaya tulisanmu tidak hilang.
      setState(() => _sending = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
      return;
    }
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Laporan terkirim — kode pelacakan ada di "Laporan Saya" & notifikasi. Terima kasih sudah berani bicara 🛡️')),
    );
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
            const SheetHeader('Buat Laporan', subtitle: 'Sampaikan dengan jujur — identitasmu dilindungi'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                // 7 kategori resmi RekanKerja (kode ↔ label Indonesia).
                for (final e in RekanKerjaApi.wbCategories.entries)
                  ChoiceChip(
                    label: Text(e.value),
                    selected: _catCode == e.key,
                    onSelected: (_) => setState(() => _catCode = e.key),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _desc,
              maxLines: 5,
              maxLength: 4000,
              decoration: const InputDecoration(
                hintText: 'Ceritakan kejadiannya: apa, kapan, di mana, siapa yang terlibat…',
                helperText: 'Minimal 20 karakter',
                counterStyle: TextStyle(fontSize: 10),
              ),
            ),
            const SizedBox(height: 12),
            _dateField(context),
            const SizedBox(height: 12),
            TextField(
              controller: _location,
              decoration: const InputDecoration(hintText: 'Lokasi kejadian (opsional) — gedung / area / online'),
            ),
            // Kontak hanya relevan bila tidak anonim — jangan pernah
            // merekam kontak pada laporan anonim.
            if (!_anon) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _contact,
                decoration: const InputDecoration(hintText: 'Kontak yang bisa dihubungi (opsional) — email / WA'),
              ),
            ],
            const SizedBox(height: 12),
            InkWell(
              onTap: () {
                setState(() => _anon = !_anon);
                widget.onAnonChanged(_anon);
              },
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: _anon ? const Color(0xFF059669).withValues(alpha: 0.07) : Theme.of(context).inputDecorationTheme.fillColor,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: _anon ? const Color(0xFF059669) : Colors.transparent,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      _anon ? Icons.check_circle_rounded : Icons.circle_outlined,
                      size: 21,
                      color: _anon ? const Color(0xFF059669) : Theme.of(context).hintColor,
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
              onPressed: _sending ? null : _submit,
              child: _sending
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                    )
                  : const Text('Kirim Laporan'),
            ),
          ],
        ),
      ),
    );
  }

  /// Tanggal kejadian — opsional, tidak boleh di masa depan.
  Widget _dateField(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Tanggal kejadian (opsional)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Theme.of(context).hintColor)),
        const SizedBox(height: 6),
        InkWell(
          onTap: () async {
            final now = DateTime.now();
            final d = await showDatePicker(
              context: context,
              initialDate: _incidentDate ?? now,
              firstDate: now.subtract(const Duration(days: 365 * 5)),
              lastDate: now, // kejadian tidak mungkin besok
            );
            if (d != null) setState(() => _incidentDate = d);
          },
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: Theme.of(context).inputDecorationTheme.fillColor,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(Icons.event_rounded, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _incidentDate == null ? 'Tidak diisi' : tanggalID(_incidentDate!, withDay: true),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: _incidentDate == null ? Theme.of(context).hintColor : null,
                    ),
                  ),
                ),
                if (_incidentDate != null)
                  GestureDetector(
                    onTap: () => setState(() => _incidentDate = null),
                    child: Icon(Icons.close_rounded, size: 16, color: Theme.of(context).hintColor),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
