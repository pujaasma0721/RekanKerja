import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Slip gaji: daftar periode + detail interaktif komponen.
/// Privacy mode menyembunyikan nominal.
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
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          // Kartu ringkasan YTD
          _YtdCard(app: app),
          const SectionTitle('Semua Periode'),
          ...app.payslips.map((p) => _PayslipTile(p: p, privacy: app.privacyMode)),
        ],
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
              Text(
                periodeID(latest.year, latest.month),
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white.withValues(alpha: 0.6)),
              ),
            ],
          ),
          const SizedBox(height: 14),
          MoneyText(
            latest.thp,
            privacy: app.privacyMode,
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
                      privacy: app.privacyMode,
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
                        privacy: app.privacyMode,
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
                        privacy: app.privacyMode,
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

class _PayslipTile extends StatelessWidget {
  final Payslip p;
  final bool privacy;
  const _PayslipTile({required this.p, required this.privacy});

  @override
  Widget build(BuildContext context) {
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
                child: Text(
                  p.month.toString().padLeft(2, '0'),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Colors.white),
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(periodeID(p.year, p.month), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 3),
                  Text(
                    '${p.penghasilan.length} komponen penghasilan · ${p.potongan.length} potongan',
                    style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                MoneyText(
                  p.thp,
                  privacy: privacy,
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
class PayslipDetailPage extends StatelessWidget {
  final Payslip payslip;
  final bool privacy;
  const PayslipDetailPage({super.key, required this.payslip, required this.privacy});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text('Slip ${periodeID(payslip.year, payslip.month)}')),
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
                  payslip.thp,
                  privacy: privacy,
                  style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: -1.2),
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _pill('Bruto', rupiah(payslip.gross, withSymbol: false), Icons.arrow_upward_rounded),
                    _pill('PPh 21', rupiah(payslip.tax, withSymbol: false), Icons.receipt_rounded),
                    _pill('Netto', rupiah(payslip.thp, withSymbol: false), Icons.south_west_rounded),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),

          // Penghasilan
          const SectionTitle('Penghasilan'),
          _componentCard(context, payslip.penghasilan, scheme.primary),

          // Potongan
          const SectionTitle('Potongan'),
          _componentCard(context, payslip.potongan, const Color(0xFFBE123C)),

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
              Text(
                'Ditandatangani elektronik oleh PT Mitra Industri Internasional',
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _pill(String label, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white.withValues(alpha: 0.8)),
          const SizedBox(width: 6),
          Text(
            '$label ${privacy ? '•••' : value}',
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.95)),
          ),
        ],
      ),
    );
  }

  Widget _componentCard(BuildContext context, List<PayComponent> comps, Color color) {
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
                    privacy: privacy,
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
