import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/widgets.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Klaim medis & travel: filter status, form pengajuan (live 2 tab), timeline.

/// Pesan INFO = fitur belum tersedia di mobile (bukan error teknis).
bool _isInfoMsg(String m) =>
    m.startsWith('Pengajuan dinas dari aplikasi mobile belum dibuka') ||
    m.startsWith('Pengajuan klaim baru dari aplikasi');

/// SnackBar hasil submit: INFO → amber + ikon info, error → merah.
void _showResult(ScaffoldMessengerState messenger, String message) {
  final info = _isInfoMsg(message);
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: info ? const Color(0xFFB45309) : const Color(0xFFBE123C),
      duration: Duration(milliseconds: info ? 4500 : 3500),
      content: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(
            info ? Icons.info_rounded : Icons.error_outline_rounded,
            color: Colors.white,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 12.5,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

/// SnackBar sukses submit klaim (hijau) — berisi docNo + pengingat kwitansi.
void _showClaimSuccess(ScaffoldMessengerState messenger, String message) {
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFF047857),
      duration: const Duration(milliseconds: 4500),
      content: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const Icon(Icons.check_circle_rounded, color: Colors.white, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '$message — kwitansi asli diserahkan ke HR untuk verifikasi ya 📎',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 12.5,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

/// "67700000" → "Rp 67,7 jt" — ringkas utk stat tile & dropdown.
String _fmtShort(double v) {
  String satu(double n) =>
      n.toStringAsFixed(n == n.truncateToDouble() ? 0 : 1).replaceAll('.', ',');
  if (v >= 1000000000) return 'Rp ${satu(v / 1000000000)} M';
  if (v >= 1000000) return 'Rp ${satu(v / 1000000)} jt';
  if (v >= 1000) return 'Rp ${satu(v / 1000)} rb';
  return 'Rp ${satu(v)}';
}

/// "1.250.000" / "1250000" → 1250000.
int _parseRp(String s) =>
    int.tryParse(s.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;

/// Warna teks peringatan amber yang terbaca di mode terang & gelap.
Color _amberText(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFFCD34D)
    : const Color(0xFFB45309);

/// Status klaim live: beberapa status tambahan (mis. "settled") tidak ada di
/// StatusChip → chip netral abu-abu agar tidak terlihat seperti menunggu.
class _ClaimStatusChip extends StatelessWidget {
  final String status;
  final bool compact;
  const _ClaimStatusChip(this.status, {this.compact = false});

  static const extraLabels = {
    'settled': 'Selesai',
    'paid': 'Dibayar',
    'processed': 'Diproses',
    'processing': 'Diproses',
  };

  @override
  Widget build(BuildContext context) {
    if (StatusChip.labels.containsKey(status)) {
      return StatusChip(status, compact: compact);
    }
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 10,
        vertical: compact ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: dark
            ? Colors.white.withValues(alpha: 0.10)
            : const Color(0xFFF5F5F4),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        extraLabels[status] ?? status,
        style: TextStyle(
          fontSize: compact ? 10 : 11,
          fontWeight: FontWeight.w800,
          color: dark ? Colors.white70 : const Color(0xFF57534E),
        ),
      ),
    );
  }
}

class ClaimsPage extends StatefulWidget {
  const ClaimsPage({super.key});

  @override
  State<ClaimsPage> createState() => _ClaimsPageState();
}

class _ClaimsPageState extends State<ClaimsPage> {
  String _filter = 'Semua';

  static const filters = [
    'Semua',
    'Menunggu',
    'Disetujui',
    'Selesai',
    'Ditolak',
  ];

  bool _inBucket(Claim c) {
    switch (_filter) {
      case 'Menunggu':
        return c.status == 'pending' || c.status == 'submitted';
      case 'Disetujui':
        return c.status == 'approved';
      case 'Selesai':
        return c.status == 'done' || c.status == 'settled';
      case 'Ditolak':
        return c.status == 'rejected';
      default:
        return true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final claims = app.claims.where(_inBucket).toList();

    // Sisa plafon klaim: live = total remainingForClaim jenis non-unlimited;
    // demo = nilai tetap seperti sebelumnya.
    final String plafon;
    if (app.isLive) {
      final hasData = app.medicalTypes.any((t) => !t.unlimited);
      final total = app.medicalTypes
          .where((t) => !t.unlimited)
          .fold<double>(0, (s, t) => s + t.remainingForClaim);
      plafon = hasData ? _fmtShort(total) : '—';
    } else {
      plafon = 'Rp 5 jt';
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Klaim Saya')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'fab-claim',
        onPressed: () => _openForm(context),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Ajukan Klaim'),
      ),
      body: RefreshIndicator(
        onRefresh: () => app.refreshAll(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
          children: [
            // Ringkasan
            Row(
              children: [
                Expanded(
                  child: StatTile(
                    icon: Icons.hourglass_top_rounded,
                    color: const Color(0xFFB45309),
                    value:
                        '${app.claims.where((c) => c.status == 'pending' || c.status == 'submitted').length}',
                    label: 'Diproses',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: StatTile(
                    icon: Icons.task_alt_rounded,
                    color: const Color(0xFF059669),
                    value: rupiah(
                      app.claims
                          .where(
                            (c) => const [
                              'approved',
                              'done',
                              'settled',
                            ].contains(c.status),
                          )
                          .map((c) => c.approvedAmount ?? c.amount)
                          .fold(0, (a, b) => a + b),
                      withSymbol: false,
                    ),
                    label: 'Total terbayar',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: StatTile(
                    icon: Icons.spa_rounded,
                    color: const Color(0xFF7C3AED),
                    value: plafon,
                    label: 'Sisa plafon klaim',
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),
            SizedBox(
              height: 36,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: filters.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final active = filters[i] == _filter;
                  final scheme = Theme.of(context).colorScheme;
                  return GestureDetector(
                    onTap: () => setState(() => _filter = filters[i]),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: active ? scheme.primary : scheme.surface,
                        borderRadius: BorderRadius.circular(999),
                        border: active
                            ? null
                            : Border.all(
                                color: Colors.black.withValues(alpha: 0.08),
                              ),
                      ),
                      child: Text(
                        filters[i],
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: active ? Colors.white : null,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 14),

            if (claims.isEmpty)
              const EmptyState(
                icon: Icons.receipt_long_rounded,
                title: 'Belum ada klaim',
                subtitle:
                    'Sakit? Periksa gigi? Semua reimbursement medis bisa diajukan di sini.',
              )
            else
              ...claims.map((c) => _ClaimCard(c: c)),
          ],
        ),
      ),
    );
  }

  static void _openForm(BuildContext context) {
    final app = context.read<AppState>();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: _ClaimFormSheet(app: app),
      ),
    );
  }
}

class _ClaimCard extends StatelessWidget {
  final Claim c;
  const _ClaimCard({required this.c});

  @override
  Widget build(BuildContext context) {
    // Live: docNo sebagai nomor dokumen, tanggal dari submittedAt,
    // klaim dinas punya varian kartu sendiri (uang muka + pertanggungjawaban).
    final live = c.docNo != null;
    final iconColor = c.isTravel
        ? const Color(0xFF0E7490)
        : const Color(0xFFDB2777);
    final meta = <String>[
      if (live) ...[
        if ((c.docNo ?? '').isNotEmpty) c.docNo!,
        if (c.submittedAt != null) tanggalID(c.submittedAt!),
      ] else ...[
        c.provider,
        tanggalID(c.date),
      ],
    ];
    final showDesc = c.description.isNotEmpty && c.description != c.type;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  c.isTravel
                      ? Icons.flight_takeoff_rounded
                      : Icons.medical_services_rounded,
                  color: iconColor,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.type,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      meta.join(' · '),
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Theme.of(context).hintColor,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    rupiah(c.amount),
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 3),
                  _ClaimStatusChip(c.status, compact: true),
                ],
              ),
            ],
          ),
          if (showDesc) ...[
            const SizedBox(height: 10),
            Text(
              '“${c.description}”',
              style: TextStyle(
                fontSize: 12,
                fontStyle: FontStyle.italic,
                color: Theme.of(context).hintColor,
              ),
            ),
          ],
          if (_hasAmountDetail) ...[
            const Divider(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Theme.of(
                  context,
                ).colorScheme.primary.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  if (c.approvedAmount != null)
                    _amountRow(
                      context,
                      'Disetujui',
                      c.approvedAmount!,
                      emphasize: true,
                    ),
                  if (c.isTravel && c.advanceAmount != null)
                    _amountRow(context, 'Uang muka', c.advanceAmount!),
                  if (c.isTravel && c.settlementAmount != null)
                    _amountRow(
                      context,
                      'Pertanggungjawaban',
                      c.settlementAmount!,
                    ),
                ],
              ),
            ),
          ],
          if (c.steps.isNotEmpty) ...[
            const Divider(height: 20),
            ApprovalTimeline(
              c.steps
                  .map((s) => ApprovalStepMV(s.role, s.name, s.status))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }

  bool get _hasAmountDetail =>
      c.approvedAmount != null ||
      (c.isTravel && (c.advanceAmount != null || c.settlementAmount != null));

  Widget _amountRow(
    BuildContext context,
    String label,
    int value, {
    bool emphasize = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 11.5,
              color: Theme.of(context).hintColor,
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          Text(
            rupiah(value),
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: emphasize ? FontWeight.w800 : FontWeight.w700,
              color: emphasize ? const Color(0xFF059669) : null,
            ),
          ),
        ],
      ),
    );
  }
}

/// Satu baris biaya pada form klaim travel.
class _TravelExpenseRow {
  final amount = TextEditingController();
  final desc = TextEditingController();
  String? expenseCode;
  DateTime? date;
  _TravelExpenseRow();
}

class _ClaimFormSheet extends StatefulWidget {
  final AppState app;
  const _ClaimFormSheet({required this.app});

  @override
  State<_ClaimFormSheet> createState() => _ClaimFormSheetState();
}

class _ClaimFormSheetState extends State<_ClaimFormSheet> {
  // ===== umum =====
  bool _tabTravel = false; // live saja — demo hanya menampilkan Medis
  bool _busy = false;
  bool _loadingForms = false;

  // ===== Medis (demo — form lama dipertahankan persis) =====
  static const demoTypes = [
    'Rawat Jalan',
    'Rawat Inap',
    'Perawatan Gigi',
    'Kacamata',
    'Persalinan',
    'Medical Check-up',
  ];
  String _type = demoTypes.first;
  final _provider = TextEditingController();
  final _amount = TextEditingController();
  final _desc = TextEditingController();

  // ===== Medis (live) =====
  String? _medTypeId;
  DateTime _treatDate = DateTime.now();
  final _receipt = TextEditingController();
  bool _forDependent = false;
  final _treatedName = TextEditingController();

  // ===== Travel (live) =====
  String? _travelReqId; // null / '' → klaim mandiri
  String? _travelTemplateCode;
  final List<_TravelExpenseRow> _rows = [];
  final _remark = TextEditingController();

  bool get _live => widget.app.isLive;

  MedClaimTypeInfo? get _selMedType =>
      widget.app.medicalTypes.where((t) => t.typeId == _medTypeId).firstOrNull;

  TravelRequestOption? get _selTravelReq {
    final id = _travelReqId;
    if (id == null || id.isEmpty) return null;
    return widget.app.travelClaimForm?.requests
        .where((r) => r.requestId == id)
        .firstOrNull;
  }

  TravelTemplateOption? get _selTemplate => widget
      .app
      .travelClaimForm
      ?.templates
      .where((t) => t.code == _travelTemplateCode)
      .firstOrNull;

  @override
  void initState() {
    super.initState();
    if (!_live) return;
    final needsLoad =
        widget.app.medicalTypes.isEmpty || widget.app.travelClaimForm == null;
    if (needsLoad) {
      _loadingForms = true;
      widget.app.loadClaimForms().whenComplete(() {
        if (mounted) {
          setState(() {
            _loadingForms = false;
            _applyDefaults();
          });
        }
      });
    } else {
      _applyDefaults();
    }
  }

  @override
  void dispose() {
    _provider.dispose();
    _amount.dispose();
    _desc.dispose();
    _receipt.dispose();
    _treatedName.dispose();
    _remark.dispose();
    for (final r in _rows) {
      r.amount.dispose();
      r.desc.dispose();
    }
    super.dispose();
  }

  /// Pilihan bawaan begitu data form termuat (jenis pertama, template pertama,
  /// satu baris biaya travel).
  void _applyDefaults() {
    if (_medTypeId == null && widget.app.medicalTypes.isNotEmpty) {
      _medTypeId = widget.app.medicalTypes.first.typeId;
    }
    final tf = widget.app.travelClaimForm;
    if (tf != null) {
      if (_travelTemplateCode == null && tf.templates.isNotEmpty) {
        _travelTemplateCode = tf.templates.first.code;
      }
      if (_rows.isEmpty) _rows.add(_TravelExpenseRow());
    }
  }

  Future<void> _reloadForms() async {
    setState(() => _loadingForms = true);
    await widget.app.loadClaimForms();
    if (mounted) {
      setState(() {
        _loadingForms = false;
        _applyDefaults();
      });
    }
  }

  void _switchTab(bool travel) {
    setState(() {
      _tabTravel = travel;
      if (travel && _rows.isEmpty) _rows.add(_TravelExpenseRow());
    });
  }

  // ================= SUBMIT =================

  Future<void> _submitDemoMedis() async {
    final messenger = ScaffoldMessenger.of(context);
    final amount = _parseRp(_amount.text);
    if (_provider.text.trim().isEmpty || amount <= 0) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Lengkapi penyedia & nominal klaim dulu ya 🙂'),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    final msg = await widget.app.submitClaim(
      type: _type,
      provider: _provider.text.trim(),
      amount: amount,
      desc: _desc.text.trim().isEmpty ? 'Klaim $_type' : _desc.text.trim(),
    );
    if (!mounted) return;
    if (msg == null) {
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            'Klaim $_type ${rupiah(amount)} terkirim — semoga lekas membaik 🤗',
          ),
        ),
      );
    } else {
      setState(() => _busy = false);
      if (_isInfoMsg(msg)) Navigator.pop(context);
      _showResult(messenger, msg);
    }
  }

  Future<void> _submitLiveMedis() async {
    final messenger = ScaffoldMessenger.of(context);
    final sel = _selMedType;
    final amount = _parseRp(_amount.text);
    if (sel == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Pilih jenis perawatan dulu ya 🙂')),
      );
      return;
    }
    if (_provider.text.trim().isEmpty || amount <= 0) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Lengkapi klinik/RS & nominal klaim dulu ya 🙂'),
        ),
      );
      return;
    }
    final dependent = sel.dependentEnabled && _forDependent;
    if (dependent && _treatedName.text.trim().isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Isi nama anggota keluarga yang dirawat ya 🙂'),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    final msg = await widget.app.submitClaim(
      type: sel.name,
      provider: _provider.text.trim(),
      amount: amount,
      desc: _desc.text.trim().isEmpty
          ? 'Perawatan ${sel.name}'
          : _desc.text.trim(),
      treatmentDate: _treatDate,
      receiptNo: _receipt.text.trim(),
      forDependent: dependent,
      treatedName: dependent ? _treatedName.text.trim() : null,
    );
    if (!mounted) return;
    if (msg == null) {
      Navigator.pop(context);
      final doc = widget.app.lastClaimDocNo;
      _showClaimSuccess(
        messenger,
        (doc == null || doc.isEmpty)
            ? 'Klaim ${sel.name} terkirim'
            : 'Klaim $doc terkirim',
      );
    } else {
      setState(() => _busy = false);
      _showResult(messenger, msg);
    }
  }

  Future<void> _submitTravel() async {
    final messenger = ScaffoldMessenger.of(context);
    final req = _selTravelReq;
    final tpl = _selTemplate;
    if (req == null && (tpl == null || tpl.code.isEmpty)) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Pilih template perjalanan dulu ya 🙂')),
      );
      return;
    }
    if (_rows.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Tambahkan minimal satu baris biaya dulu ya 🙂'),
        ),
      );
      return;
    }
    final expenses =
        <({String code, DateTime? date, String desc, int amount})>[];
    for (final r in _rows) {
      final amount = _parseRp(r.amount.text);
      final type = widget.app.travelClaimForm?.expenseTypes
          .where((t) => t.code == r.expenseCode)
          .firstOrNull;
      if (type == null || amount <= 0) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text(
              'Lengkapi jenis biaya & nominal tiap baris dulu ya 🙂',
            ),
          ),
        );
        return;
      }
      expenses.add((
        code: type.code,
        date: r.date,
        desc: r.desc.text.trim(),
        amount: amount,
      ));
    }
    setState(() => _busy = true);
    final msg = await widget.app.submitTravelClaim(
      request: req,
      template: req == null ? tpl : null,
      expenses: expenses,
      remark: _remark.text.trim(),
    );
    if (!mounted) return;
    if (msg == null) {
      final total = expenses.fold<int>(0, (s, e) => s + e.amount);
      Navigator.pop(context);
      final doc = widget.app.lastClaimDocNo;
      _showClaimSuccess(
        messenger,
        (doc == null || doc.isEmpty)
            ? 'Klaim travel ${rupiah(total)} terkirim'
            : 'Klaim $doc terkirim (${rupiah(total)})',
      );
    } else {
      setState(() => _busy = false);
      _showResult(messenger, msg);
    }
  }

  // ================= BUILD =================

  @override
  Widget build(BuildContext context) {
    // ListenableBuilder → dropdown ikut terisi begitu loadClaimForms selesai.
    return ListenableBuilder(
      listenable: widget.app,
      builder: (context, _) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SheetHeader(
              'Ajukan Klaim',
              subtitle: _tabTravel && _live
                  ? 'Pertanggungjawaban perjalanan dinas'
                  : 'Reimbursement medis & kesehatan',
            ),
            if (_live) ...[
              _buildSegment(context),
              const SizedBox(height: 16),
              if (!_tabTravel)
                _buildLiveMedis(context)
              else
                _buildTravelTab(context),
            ] else
              _buildDemoMedis(context),
          ],
        ),
      ),
    );
  }

  /// Segmen [Klaim Medis | Klaim Travel] — hanya live.
  Widget _buildSegment(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget seg(bool travel, IconData icon, String label) {
      final active = _tabTravel == travel;
      return Expanded(
        child: GestureDetector(
          onTap: () => _switchTab(travel),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: BoxDecoration(
              color: active ? scheme.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 16,
                  color: active ? Colors.white : scheme.primary,
                ),
                const SizedBox(width: 7),
                Flexible(
                  child: Text(
                    label,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: active ? Colors.white : scheme.primary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Theme.of(context).inputDecorationTheme.fillColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          seg(false, Icons.medical_services_rounded, 'Klaim Medis'),
          seg(true, Icons.flight_takeoff_rounded, 'Klaim Travel'),
        ],
      ),
    );
  }

  /// Kartu kecil "sedang memuat / gagal muat + coba lagi".
  Widget _buildFormLoader(BuildContext context, String what) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 26),
      child: Column(
        children: [
          if (_loadingForms) ...[
            const SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(strokeWidth: 2.6),
            ),
            const SizedBox(height: 12),
            Text(
              'Memuat $what…',
              style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).hintColor,
              ),
            ),
          ] else ...[
            Icon(
              Icons.cloud_off_rounded,
              size: 30,
              color: Theme.of(context).hintColor,
            ),
            const SizedBox(height: 8),
            Text(
              '$what gagal dimuat',
              style: TextStyle(
                fontSize: 12.5,
                color: Theme.of(context).hintColor,
              ),
            ),
            const SizedBox(height: 6),
            TextButton.icon(
              onPressed: _reloadForms,
              icon: const Icon(Icons.refresh_rounded, size: 17),
              label: const Text('Coba lagi'),
            ),
          ],
        ],
      ),
    );
  }

  // ===== Tab Medis — mode demo (form lama, tidak berubah) =====

  Widget _buildDemoMedis(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final t in demoTypes)
              ChoiceChip(
                label: Text(t),
                selected: _type == t,
                onSelected: (_) => setState(() => _type = t),
              ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _provider,
          decoration: const InputDecoration(
            hintText: 'Nama klinik / rumah sakit / optik',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _amount,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            hintText: 'Total biaya (Rp)',
            prefixText: 'Rp ',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _desc,
          maxLines: 2,
          decoration: const InputDecoration(
            hintText: 'Ringkasan tindakan / obat',
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Icon(
              Icons.attach_file_rounded,
              size: 16,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Lampiran foto nota (ambil dari kamera) — hadir di versi berikutnya',
                style: TextStyle(
                  fontSize: 10.5,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _busy ? null : _submitDemoMedis,
          child: _busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.4,
                    color: Colors.white,
                  ),
                )
              : const Text('Kirim Klaim'),
        ),
      ],
    );
  }

  // ===== Tab Medis — mode live =====

  Widget _buildLiveMedis(BuildContext context) {
    final app = widget.app;
    if (app.medicalTypes.isEmpty) {
      return _buildFormLoader(context, 'jenis klaim medis');
    }

    final sel = _selMedType;
    final amountVal = _parseRp(_amount.text);
    final overLimit =
        sel != null && !sel.unlimited && amountVal > sel.remainingForClaim;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Jenis perawatan + sisa plafon
        DropdownButtonFormField<MedClaimTypeInfo>(
          value: sel,
          isExpanded: true,
          decoration: const InputDecoration(hintText: 'Jenis perawatan'),
          items: [
            for (final t in app.medicalTypes)
              DropdownMenuItem(
                value: t,
                child: Text(
                  '${t.name} — ${t.unlimited ? '∞' : _fmtShort(t.remainingForClaim)}',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
          ],
          onChanged: (t) => setState(() => _medTypeId = t?.typeId),
        ),
        if (sel != null) ...[
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              [
                if (sel.unlimited)
                  'Sisa plafon: ∞ (tanpa batas nominal)'
                else
                  'Sisa plafon: ${rupiah(sel.remainingForClaim)}'
                      '${sel.pendingReserved > 0 ? ' — ${rupiah(sel.pendingReserved)} masih menunggu approval' : ''}',
                if (!sel.freqUnlimited)
                  'maks ${sel.freqValue}×/tahun'
                      '${sel.claimCountYear > 0 ? ' (sudah ${sel.claimCountYear}×)' : ''}',
                if (sel.dependentEnabled) 'bisa untuk keluarga',
              ].join(' · '),
              style: TextStyle(
                fontSize: 10.5,
                color: Theme.of(context).hintColor,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],

        // Tanggal perawatan
        const SizedBox(height: 12),
        InkWell(
          onTap: () async {
            final now = DateTime.now();
            final initial = _treatDate.isAfter(now) ? now : _treatDate;
            final d = await showDatePicker(
              context: context,
              initialDate: initial,
              firstDate: DateTime(now.year, 1, 1),
              lastDate: now,
            );
            if (d != null) setState(() => _treatDate = d);
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
                const Icon(Icons.healing_rounded, size: 20),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    'Tanggal perawatan',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: Theme.of(
                      context,
                    ).colorScheme.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    tanggalID(_treatDate),
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _provider,
          decoration: const InputDecoration(
            hintText: 'Nama klinik / rumah sakit / optik',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _desc,
          maxLines: 2,
          decoration: const InputDecoration(
            hintText:
                'Ringkasan tindakan / obat (mis. scaling gigi, konsultasi…)',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _receipt,
          decoration: const InputDecoration(
            hintText: 'No. kwitansi / tagihan (opsional)',
          ),
        ),

        // Klaim untuk keluarga / dependent
        if (sel != null && sel.dependentEnabled) ...[
          const SizedBox(height: 12),
          Container(
            decoration: BoxDecoration(
              color: Theme.of(context).inputDecorationTheme.fillColor,
              borderRadius: BorderRadius.circular(14),
            ),
            child: SwitchListTile(
              value: _forDependent,
              onChanged: (v) => setState(() => _forDependent = v),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14),
              title: const Text(
                'Untuk keluarga / dependent',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
              ),
              subtitle: Text(
                _forDependent
                    ? 'Plafon keluarga ikut dievaluasi'
                    : 'Sekarang: atas nama diri sendiri',
                style: TextStyle(
                  fontSize: 11,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ),
          ),
          if (_forDependent) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _treatedName,
              decoration: const InputDecoration(
                hintText: 'Nama anggota keluarga yang dirawat',
              ),
            ),
          ],
        ],

        // Total biaya
        const SizedBox(height: 12),
        TextField(
          controller: _amount,
          keyboardType: TextInputType.number,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            hintText: 'Total biaya (Rp)',
            prefixText: 'Rp ',
          ),
        ),
        if (overLimit) ...[
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              '⚠️  Nominal melebihi sisa plafon ${rupiah(sel.remainingForClaim)} — tetap bisa dikirim, '
              'HR yang memutuskan nominal akhirnya.',
              style: TextStyle(
                fontSize: 10.5,
                color: _amberText(context),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        const SizedBox(height: 10),
        Row(
          children: [
            Icon(
              Icons.attach_file_rounded,
              size: 16,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Kwitansi asli/tagihan tetap diserahkan ke HR untuk verifikasi sebelum klaim disetujui.',
                style: TextStyle(
                  fontSize: 10.5,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _busy ? null : _submitLiveMedis,
          child: _busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.4,
                    color: Colors.white,
                  ),
                )
              : const Text('Kirim Klaim'),
        ),
      ],
    );
  }

  // ===== Tab Travel — mode live =====

  Widget _buildTravelTab(BuildContext context) {
    final app = widget.app;
    final form = app.travelClaimForm;
    if (form == null) return _buildFormLoader(context, 'data klaim perjalanan');
    final req = _selTravelReq;
    final total = _rows.fold<int>(0, (s, r) => s + _parseRp(r.amount.text));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Dasar klaim: pengajuan dinas ATAU mandiri
        DropdownButtonFormField<String>(
          value: req?.requestId ?? '',
          isExpanded: true,
          decoration: const InputDecoration(hintText: 'Dasar klaim'),
          items: [
            const DropdownMenuItem(
              value: '',
              child: Text('Klaim mandiri (tanpa pengajuan dinas)'),
            ),
            for (final r in form.requests)
              DropdownMenuItem(
                value: r.requestId,
                child: Text(
                  '${r.docNo} — ${r.purpose}'
                  '${r.advanceAmount > 0 ? ' (${_fmtShort(r.advanceAmount.toDouble())} uang muka)' : ''}',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
          ],
          onChanged: (id) => setState(() => _travelReqId = id),
        ),

        // Mandiri → pilih template; request → kartu info perjalanan
        if (req == null) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<TravelTemplateOption>(
            value: _selTemplate,
            isExpanded: true,
            decoration: const InputDecoration(hintText: 'Template perjalanan'),
            items: [
              for (final t in form.templates)
                DropdownMenuItem(
                  value: t,
                  child: Text(
                    t.name,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
            ],
            onChanged: (t) => setState(() => _travelTemplateCode = t?.code),
          ),
        ] else ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF0E7490).withValues(alpha: 0.07),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFF0E7490).withValues(alpha: 0.25),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.flight_takeoff_rounded,
                      size: 18,
                      color: Color(0xFF0E7490),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        req.purpose.isEmpty ? req.docNo : req.purpose,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0E7490).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${req.days} hari',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF0E7490),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  [
                    if (req.destinations.isNotEmpty)
                      'Tujuan: ${req.destinations.join(', ')}',
                    'Perjalanan: ${req.rentangPendek}',
                    'Uang muka: ${rupiah(req.advanceAmount)}',
                    if (req.templateName.isNotEmpty) req.templateName,
                  ].join('  ·  '),
                  style: TextStyle(
                    fontSize: 11.5,
                    color: Theme.of(context).hintColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],

        // Baris-baris biaya
        const SizedBox(height: 14),
        for (final r in _rows) _buildExpenseRow(context, r),
        OutlinedButton.icon(
          onPressed: _busy
              ? null
              : () => setState(() => _rows.add(_TravelExpenseRow())),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: const Text('Tambah biaya'),
        ),

        // Total
        Padding(
          padding: const EdgeInsets.only(top: 14, left: 4, right: 4),
          child: Row(
            children: [
              Text(
                'Total biaya',
                style: TextStyle(
                  fontSize: 12.5,
                  color: Theme.of(context).hintColor,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              Text(
                app.privacyMode && total > 0 ? 'Rp ••••' : rupiah(total),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.3,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _remark,
          maxLines: 2,
          decoration: const InputDecoration(
            hintText: 'Catatan untuk HR/Finance (opsional)',
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Icon(
              Icons.attach_file_rounded,
              size: 16,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Kwitansi tiap biaya tetap diserahkan ke HR/Finance untuk verifikasi sebelum klaim disetujui.',
                style: TextStyle(
                  fontSize: 10.5,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _busy ? null : _submitTravel,
          child: _busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.4,
                    color: Colors.white,
                  ),
                )
              : const Text('Kirim Klaim Travel'),
        ),
      ],
    );
  }

  Widget _buildExpenseRow(BuildContext context, _TravelExpenseRow r) {
    final form = widget.app.travelClaimForm;
    final types = form?.expenseTypes ?? const <TravelExpenseTypeOption>[];
    final sel = types.where((t) => t.code == r.expenseCode).firstOrNull;
    final needDocs = _rows.any(
      (row) =>
          types.where((t) => t.code == row.expenseCode).firstOrNull?.needDocs ??
          false,
    );

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.black.withValues(alpha: 0.06),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<TravelExpenseTypeOption>(
                  value: sel,
                  isExpanded: true,
                  decoration: const InputDecoration(hintText: 'Jenis biaya'),
                  selectedItemBuilder: (_) => [
                    for (final t in types)
                      Text(
                        t.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13),
                      ),
                  ],
                  items: [
                    for (final t in types)
                      DropdownMenuItem(
                        value: t,
                        child: Text(
                          t.limitAmount > 0 && !t.unlimited
                              ? '${t.name} — maks ${rupiah(t.limitAmount)}'
                              : t.name,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                  ],
                  onChanged: (t) => setState(() => r.expenseCode = t?.code),
                ),
              ),
              IconButton(
                tooltip: 'Hapus baris',
                visualDensity: VisualDensity.compact,
                onPressed: _busy
                    ? null
                    : () => setState(() {
                        final i = _rows.indexOf(r);
                        if (i >= 0) {
                          r.amount.dispose();
                          r.desc.dispose();
                          _rows.removeAt(i);
                        }
                      }),
                icon: Icon(
                  Icons.delete_outline_rounded,
                  size: 20,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ],
          ),
          if (sel != null && sel.limitAmount > 0 && !sel.unlimited) ...[
            const SizedBox(height: 4),
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                'Batas ${rupiah(sel.limitAmount)} per pengajuan'
                '${sel.needDocs ? ' · perlu kwitansi' : ''}',
                style: TextStyle(
                  fontSize: 10.5,
                  color: Theme.of(context).hintColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          InkWell(
            onTap: _busy ? null : () => _pickExpenseDate(r),
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              decoration: BoxDecoration(
                color: Theme.of(context).inputDecorationTheme.fillColor,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Icon(Icons.event_rounded, size: 17),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      r.date == null ? 'Tanggal biaya' : tanggalID(r.date!),
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: r.date == null
                            ? Theme.of(context).hintColor
                            : null,
                      ),
                    ),
                  ),
                  if (r.date == null)
                    Icon(
                      Icons.expand_more_rounded,
                      size: 16,
                      color: Theme.of(context).hintColor,
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: r.amount,
                  keyboardType: TextInputType.number,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Nominal (Rp)',
                    prefixText: 'Rp ',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: TextField(
                  controller: r.desc,
                  decoration: const InputDecoration(
                    hintText: 'Keterangan (mis. Hotel 4 malam)',
                  ),
                ),
              ),
            ],
          ),
          if (needDocs && (sel == null || sel.needDocs)) ...[
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                'Jenis biaya ini membutuhkan kwitansi fisik saat verifikasi.',
                style: TextStyle(
                  fontSize: 10.5,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Pilih tanggal satu baris biaya. Bila dasar klaim = pengajuan dinas,
  /// jendela tanggal dibatasi rentang perjalanannya (server menolak di luar).
  Future<void> _pickExpenseDate(_TravelExpenseRow row) async {
    final now = DateTime.now();
    final req = _selTravelReq;
    var first = DateTime(now.year, 1, 1);
    var last = now;
    if (req != null) {
      first = req.dateFrom;
      last = req.dateTo.isAfter(now) ? now : req.dateTo;
      if (last.isBefore(first)) {
        last = req.dateTo; // data aneh → pakai rentang penuh
      }
    }
    var initial = row.date ?? req?.dateFrom ?? now;
    if (initial.isBefore(first)) initial = first;
    if (initial.isAfter(last)) initial = last;
    final d = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
    );
    if (d != null) setState(() => row.date = d);
  }
}
