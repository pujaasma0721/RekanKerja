import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../data/api_client.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Label periode slip — utamakan `periodName` dari server (live, mis.
/// "AGUSTUS 2026"); fallback ke label lokal saat kosong / bulan tak terparse.
String _periodeLabel(Payslip p) {
  final name = p.labelPeriode.trim();
  if (name.isNotEmpty) return name;
  if (p.month >= 1 && p.month <= 12) return periodeID(p.year, p.month);
  if (p.year > 0) return 'Periode ${p.year}';
  return 'Slip Gaji';
}

/// Angka bulan utk badge ikon — null bila periode tak dikenali.
int? _bulanBadge(Payslip p) {
  if (p.month >= 1 && p.month <= 12) return p.month;
  final name = p.labelPeriode.toLowerCase();
  for (int i = 0; i < bulanID.length; i++) {
    if (name.contains(bulanID[i].toLowerCase())) return i + 1;
  }
  return null;
}

/// Slip gaji: daftar periode + detail interaktif komponen.
/// Privacy mode menyembunyikan nominal; brankas payroll terkunci (server
/// mengirim 0) juga diperlakukan tersembunyi ("•••").
class PayslipPage extends StatelessWidget {
  const PayslipPage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Slip Gaji'),
        actions: [
          IconButton(
            tooltip: app.privacyMode ? 'Tampilkan nominal' : 'Sembunyikan nominal',
            onPressed: () => app.togglePrivacy(),
            icon: Icon(
              app.privacyMode ? Icons.visibility_off_rounded : Icons.visibility_rounded,
              size: 20,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
          children: [
            if (app.payslips.isEmpty)
              const EmptyState(
                icon: Icons.receipt_long_rounded,
                title: 'Belum ada slip gaji',
                subtitle: 'Slip akan muncul di sini setelah payroll diproses oleh HR. Tarik ke bawah untuk memuat ulang.',
              )
            else ...[
              // Kartu ringkasan YTD
              _YtdCard(app: app),
              const SectionTitle('Semua Periode'),
              ...app.payslips.map((p) => _PayslipTile(p: p, privacy: app.privacyMode)),
            ],
          ],
        ),
      ),
    );
  }
}

class _YtdCard extends StatelessWidget {
  final AppState app;
  const _YtdCard({required this.app});

  @override
  Widget build(BuildContext context) {
    final latest = app.payslips.first;
    final avg = app.payslips.take(3).map((p) => p.thp).reduce((a, b) => a + b) ~/ 3;
    // Brankas payroll terkunci → server mengirim 0 → samarkan spt privacy mode.
    final masked = app.privacyMode || (latest.thp == 0 && latest.gross == 0);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1C2B26), Color(0xFF2A3F37)],
        ),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.payments_rounded, color: Color(0xFF6EE7B7), size: 20),
              ),
              const SizedBox(width: 10),
              Text(
                'Take home terakhir',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white.withValues(alpha: 0.75)),
              ),
              const Spacer(),
              Flexible(
                child: Text(
                  _periodeLabel(latest),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white.withValues(alpha: 0.6)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          MoneyText(
            latest.thp,
            privacy: masked,
            style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -1.2, height: 1),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('GAJI KOTOR', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.5), letterSpacing: 0.5)),
                    const SizedBox(height: 3),
                    MoneyText(
                      latest.gross,
                      privacy: masked,
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.9)),
                    ),
                  ],
                ),
              ),
              Container(width: 1, height: 30, color: Colors.white.withValues(alpha: 0.12)),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(left: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('PPh 21', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.5), letterSpacing: 0.5)),
                      const SizedBox(height: 3),
                      MoneyText(
                        latest.tax,
                        // Di live, PPh 21 baru tersedia saat rincian dibuka →
                        // jangan tampilkan "Rp 0" yang menyesatkan.
                        privacy: masked || latest.tax == 0,
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.amber[300]),
                      ),
                    ],
                  ),
                ),
              ),
              Container(width: 1, height: 30, color: Colors.white.withValues(alpha: 0.12)),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(left: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('RATA 3 BLN', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.5), letterSpacing: 0.5)),
                      const SizedBox(height: 3),
                      MoneyText(
                        avg,
                        privacy: masked,
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.9)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Chip status slip live: Paid → Terbayar, Confirmed → Terkonfirmasi.
class _SlipStatusChip extends StatelessWidget {
  final String status;
  const _SlipStatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final s = status.trim().toLowerCase();
    final (Color fg, Color bg, String label) = switch (s) {
      'paid' => (const Color(0xFF059669), const Color(0xFFECFDF5), 'Terbayar'),
      'confirmed' => (const Color(0xFF0F766E), const Color(0xFFCCFBF1), 'Terkonfirmasi'),
      _ => (const Color(0xFF475569), const Color(0xFFF1F5F9), status),
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

class _PayslipTile extends StatelessWidget {
  final Payslip p;
  final bool privacy;
  const _PayslipTile({required this.p, required this.privacy});

  @override
  Widget build(BuildContext context) {
    final bulan = _bulanBadge(p);
    final hasStatus = (p.status ?? '').trim().isNotEmpty;
    // Live: komponen diambil lazy saat slip dibuka.
    final hasComponents = p.components.isNotEmpty;
    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => PayslipDetailPage(payslip: p, privacy: privacy)),
      ),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
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
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                gradient: AppTheme.heroGradient,
                borderRadius: BorderRadius.circular(15),
              ),
              child: Center(
                child: bulan != null
                    ? Text(
                        bulan.toString().padLeft(2, '0'),
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Colors.white),
                      )
                    : Icon(Icons.calendar_month_rounded, size: 20, color: Colors.white.withValues(alpha: 0.9)),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_periodeLabel(p), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 3),
                  Text(
                    hasComponents
                        ? '${p.penghasilan.length} komponen penghasilan · ${p.potongan.length} potongan'
                        : 'Ketuk untuk melihat rincian komponen',
                    style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (hasStatus) ...[
                  _SlipStatusChip(status: p.status!),
                  const SizedBox(height: 4),
                ],
                MoneyText(
                  p.thp,
                  // Brankas terkunci → server mengirim 0 → sembunyikan.
                  privacy: privacy || p.thp == 0,
                  style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w900, color: Color(0xFF059669), letterSpacing: -0.4),
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Icon(Icons.download_rounded, size: 12, color: Theme.of(context).hintColor),
                    const SizedBox(width: 3),
                    Text('Detail', style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w700)),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Detail slip: daftar komponen penghasilan & potongan.
/// Live: komponen diambil lazy dari server saat halaman dibuka.
class PayslipDetailPage extends StatefulWidget {
  final Payslip payslip;
  final bool privacy;
  const PayslipDetailPage({super.key, required this.payslip, required this.privacy});

  @override
  State<PayslipDetailPage> createState() => _PayslipDetailPageState();
}

class _PayslipDetailPageState extends State<PayslipDetailPage> {
  Payslip? _slip;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _slip = widget.payslip;
    // Live: header tanpa komponen → ambil rincian begitu halaman terbuka.
    if (widget.payslip.lineId != null && widget.payslip.components.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadDetail());
    }
  }

  Future<void> _loadDetail() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final full = await context.read<AppState>().loadPayslipDetail(widget.payslip);
      if (!mounted) return;
      setState(() {
        _slip = full;
        _loading = false;
      });
    } on ApiException catch (e) {
      _fail(e.message);
    } catch (_) {
      _fail('Rincian slip gagal dimuat — periksa koneksi lalu coba lagi.');
    }
  }

  void _fail(String msg) {
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = msg;
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final scheme = Theme.of(context).colorScheme;
    final slip = _slip ?? widget.payslip;
    // Brankas payroll terkunci → server mengirim 0 → samarkan.
    final masked = widget.privacy || (slip.thp == 0 && slip.gross == 0);
    final totalPot = slip.totalDeductions;
    final hasStatus = (slip.status ?? '').trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: Text('Slip ${_periodeLabel(slip)}')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          // Header besar
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(gradient: AppTheme.heroGradient, borderRadius: BorderRadius.circular(24)),
            child: Column(
              children: [
                Text(
                  'TAKE HOME PAY',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.white.withValues(alpha: 0.7), letterSpacing: 1.2),
                ),
                const SizedBox(height: 8),
                MoneyText(
                  slip.thp,
                  privacy: masked,
                  style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -1.2),
                ),
                if (hasStatus || slip.paidAt != null) ...[
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (hasStatus) _SlipStatusChip(status: slip.status!),
                      if (hasStatus && slip.paidAt != null) const SizedBox(width: 8),
                      if (slip.paidAt != null)
                        Flexible(
                          child: Text(
                            'Dibayar ${tanggalID(slip.paidAt!)}',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white.withValues(alpha: 0.75)),
                          ),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 14),
                Wrap(
                  alignment: WrapAlignment.spaceEvenly,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _pill('Bruto', rupiah(slip.gross, withSymbol: false), Icons.arrow_upward_rounded, masked),
                    _pill(
                      totalPot != null ? 'Total Potongan' : 'PPh 21',
                      rupiah(totalPot ?? slip.tax, withSymbol: false),
                      Icons.receipt_rounded,
                      masked,
                    ),
                    _pill('Netto', rupiah(slip.thp, withSymbol: false), Icons.south_west_rounded, masked),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),

          // Komponen (live: lazy load)
          if (_loading)
            _loadingCard(context)
          else if (_error != null)
            _errorCard(context)
          else if (slip.components.isEmpty)
            _emptyComponentsCard(context)
          else ...[
            // Penghasilan
            const SectionTitle('Penghasilan'),
            _componentCard(context, slip.penghasilan, scheme.primary),

            // Potongan
            const SectionTitle('Potongan'),
            _componentCard(context, slip.potongan, const Color(0xFFBE123C)),
          ],

          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Unduh PDF tersedia saat tersambung ke server OneVity 🔒')),
              );
            },
            icon: const Icon(Icons.picture_as_pdf_rounded, size: 18),
            label: const Text('Unduh Slip (PDF)'),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.verified_user_rounded, size: 13, color: Theme.of(context).hintColor),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  'Ditandatangani elektronik oleh ${app.employee.companyName ?? 'PT Mitra Industri Internasional'}',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _loadingCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(28),
      decoration: _cardDeco(context),
      child: const Column(
        children: [
          SizedBox(height: 26, width: 26, child: CircularProgressIndicator(strokeWidth: 2.4)),
          SizedBox(height: 14),
          Text('Memuat rincian komponen…', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _errorCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: _cardDeco(context),
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, size: 28, color: Theme.of(context).colorScheme.error),
          const SizedBox(height: 10),
          Text(
            _error!,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, color: Theme.of(context).hintColor, height: 1.4),
          ),
          const SizedBox(height: 14),
          FilledButton.tonalIcon(
            onPressed: _loadDetail,
            icon: const Icon(Icons.refresh_rounded, size: 17),
            label: const Text('Coba Lagi'),
          ),
        ],
      ),
    );
  }

  Widget _emptyComponentsCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: _cardDeco(context),
      child: Row(
        children: [
          Icon(Icons.info_outline_rounded, size: 20, color: Theme.of(context).hintColor),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Rincian komponen belum tersedia untuk periode ini.',
              style: TextStyle(fontSize: 12.5, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  BoxDecoration _cardDeco(BuildContext context) {
    return BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(
        color: Theme.of(context).brightness == Brightness.dark
            ? Colors.white.withValues(alpha: 0.06)
            : Colors.black.withValues(alpha: 0.05),
      ),
    );
  }

  Widget _pill(String label, String value, IconData icon, bool masked) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white.withValues(alpha: 0.8)),
          const SizedBox(width: 6),
          Text(
            '$label ${masked ? '•••' : value}',
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.95)),
          ),
        ],
      ),
    );
  }

  Widget _componentCard(BuildContext context, List<PayComponent> comps, Color color) {
    return Container(
      decoration: _cardDeco(context),
      child: Column(
        children: [
          for (int i = 0; i < comps.length; i++) ...[
            if (i > 0) const Divider(indent: 16, endIndent: 16),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(comps[i].name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                        if (comps[i].note.isNotEmpty)
                          Text(
                            comps[i].note,
                            style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor),
                          ),
                      ],
                    ),
                  ),
                  MoneyText(
                    comps[i].amount,
                    privacy: widget.privacy,
                    style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: color),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
