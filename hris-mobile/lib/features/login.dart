import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../data/app_state.dart';
import '../data/models.dart';

/// Splash + Login — pintu masuk aplikasi.
/// Nuansa fintech: gradasi emerald, monogram besar, form mengambang.
///
/// Menghadapi backend OneVity asli (https://onevity.sayone.my.id):
///  1. email + kata sandi  →  POST /api/auth/login
///  2. (opsional) kode MFA 6 digit — bila akun mengaktifkan TOTP
///  3. (opsional) pilih workspace — bila akun multi-perusahaan
/// Mode Demo tetap tersedia untuk mencoba tanpa server.
class LoginGate extends StatefulWidget {
  const LoginGate({super.key});

  @override
  State<LoginGate> createState() => _LoginGateState();
}

class _LoginGateState extends State<LoginGate> {
  bool _splash = true;

  @override
  void initState() {
    super.initState();
    _splashUntilReady();
  }

  /// Splash minimal 1,6 detik — dan tunggu restore sesi tersimpan selesai
  /// (maks ±12 detik waktu-palsu agar tak pernah menggantung di test).
  void _splashUntilReady() async {
    await Future.delayed(const Duration(milliseconds: 1600));
    if (!mounted) return;
    final app = context.read<AppState>();
    int guard = 0;
    while (mounted && app.restoring && guard++ < 100) {
      await Future.delayed(const Duration(milliseconds: 120));
    }
    if (mounted) setState(() => _splash = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_splash) return const _SplashView();
    return const _LoginView();
  }
}

class _SplashView extends StatelessWidget {
  const _SplashView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppTheme.heroGradient),
        child: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: 1),
                  duration: const Duration(milliseconds: 700),
                  curve: Curves.elasticOut,
                  builder: (_, v, child) =>
                      Transform.scale(scale: v, child: child),
                  child: Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(30),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.25),
                          blurRadius: 30,
                          offset: const Offset(0, 12),
                        ),
                      ],
                    ),
                    child: const Center(
                      child: Text(
                        '1V',
                        style: TextStyle(
                          fontSize: 40,
                          fontWeight: FontWeight.w900,
                          color: AppTheme.seed,
                          letterSpacing: -2,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 28),
                const Text(
                  'OneVity',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'HR suite teman kerjamu, bukan sekadar kantor.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 48),
                SizedBox(
                  width: 26,
                  height: 26,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.6,
                    backgroundColor: Colors.white24,
                    color: Colors.white.withValues(alpha: 0.9),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LoginView extends StatelessWidget {
  const _LoginView();

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      backgroundColor: const Color(0xFF04241B),
      body: Container(
        decoration: const BoxDecoration(gradient: AppTheme.heroGradient),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, cons) {
              return SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: cons.maxHeight),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: 44),
                      GestureDetector(
                        // Long-press logo: atur server (dev → produksi).
                        onLongPress: () => _openServerSettings(context, app),
                        child: Container(
                          width: 58,
                          height: 58,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: const Center(
                            child: Text(
                              '1V',
                              style: TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.w900,
                                color: AppTheme.seed,
                                letterSpacing: -1,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      const Text(
                        'Halo, senang kamu datang! 👋',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 26,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Masuk untuk absen, cuti, slip gaji, dan semua\nkebutuhan kerjamu — satu aplikasi.',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.85),
                          fontSize: 14,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 32),
                      if (app.pendingMfaToken != null)
                        _MfaCard(app: app)
                      else if (app.pendingWorkspaces.isNotEmpty)
                        _WorkspacePicker(app: app)
                      else
                        _LoginForm(app: app),
                      const SizedBox(height: 28),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Container(width: 36, height: 4, decoration: BoxDecoration(color: Colors.white38, borderRadius: BorderRadius.circular(2))),
                          const SizedBox(width: 8),
                          Container(width: 16, height: 4, decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.9), borderRadius: BorderRadius.circular(2))),
                          const SizedBox(width: 8),
                          Container(width: 8, height: 4, decoration: BoxDecoration(color: Colors.white38, borderRadius: BorderRadius.circular(2))),
                        ],
                      ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  void _openServerSettings(BuildContext context, AppState app) {
    final controller = TextEditingController(text: app.apiClient.baseUrl);
    showDialog(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('Server OneVity'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: 'https://onevity.sayone.my.id',
                labelText: 'Base URL API',
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Default: produksi OneVity. Ubah hanya untuk development.',
              style: TextStyle(fontSize: 11.5, color: Colors.black54),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              await app.resetServerUrl();
              if (dctx.mounted) Navigator.pop(dctx);
            },
            child: const Text('Reset'),
          ),
          FilledButton(
            onPressed: () async {
              await app.setServerUrl(controller.text.trim());
              if (dctx.mounted) Navigator.pop(dctx);
            },
            child: const Text('Simpan'),
          ),
        ],
      ),
    );
  }
}

/// Form utama: email + kata sandi → login live, atau tombol mode demo.
class _LoginForm extends StatefulWidget {
  final AppState app;
  const _LoginForm({required this.app});

  @override
  State<_LoginForm> createState() => _LoginFormState();
}

class _LoginFormState extends State<_LoginForm> {
  final _email = TextEditingController();
  final _pass = TextEditingController();
  bool _obscure = true;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    if (_email.text.trim().isEmpty || _pass.text.isEmpty) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Isi email kantor dan kata sandi dulu ya'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    setState(() => _busy = true);
    final res = await widget.app.loginLive(_email.text.trim(), _pass.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (res.stage == LoginStage.error) {
      messenger.showSnackBar(SnackBar(
        content: Text(res.error ?? 'Login gagal'),
        behavior: SnackBarBehavior.floating,
      ));
    }
    // stage lain (mfa/pickTenant/done) → UI berpindah sendiri lewat state app.
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 40,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Masuk ke Workspace',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppTheme.deepInk,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Gunakan akun kantor perusahaanmu',
            style: TextStyle(fontSize: 12.5, color: Colors.black45),
          ),
          const SizedBox(height: 22),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.alternate_email_rounded, size: 20),
              hintText: 'nama@perusahaan.co.id',
              labelText: 'Email kantor',
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _pass,
            obscureText: _obscure,
            onSubmitted: (_) => _submit(),
            autofillHints: const [AutofillHints.password],
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.lock_outline_rounded, size: 20),
              labelText: 'Kata sandi',
              suffixIcon: IconButton(
                icon: Icon(_obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20),
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                  )
                : const Text('Masuk Sekarang'),
          ),
          const SizedBox(height: 10),
          Text(
            'Terhubung ke ${app.serverHost}',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11, color: Colors.black38),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.fingerprint_rounded, size: 16, color: Colors.black38),
              const SizedBox(width: 6),
              const Text(
                'Login biometrik akan hadir',
                style: TextStyle(fontSize: 12, color: Colors.black38),
              ),
            ],
          ),
          const Divider(height: 28),
          TextButton.icon(
            onPressed: () => app.loginDemo(),
            icon: const Icon(Icons.auto_awesome_rounded, size: 17),
            label: const Text('Coba Mode Demo'),
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFF059669),
              textStyle: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// Langkah MFA: kode 6 digit dari aplikasi authenticator.
class _MfaCard extends StatefulWidget {
  final AppState app;
  const _MfaCard({required this.app});

  @override
  State<_MfaCard> createState() => _MfaCardState();
}

class _MfaCardState extends State<_MfaCard> {
  final _code = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final messenger = ScaffoldMessenger.of(context);
    if (_code.text.trim().length != 6) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Masukkan 6 digit kode dari aplikasi authenticator'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    setState(() => _busy = true);
    final res = await widget.app.verifyMfaLive(_code.text.trim());
    if (!mounted) return;
    setState(() => _busy = false);
    if (res.stage == LoginStage.error) {
      messenger.showSnackBar(SnackBar(
        content: Text(res.error ?? 'Kode salah'),
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 40,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.phonelink_lock_rounded, color: AppTheme.seed),
              SizedBox(width: 10),
              Text(
                'Verifikasi 2 Langkah',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.deepInk),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Masukkan 6 digit kode dari aplikasi authenticator kamu.',
            style: TextStyle(fontSize: 12.5, color: Colors.black45),
          ),
          const SizedBox(height: 22),
          TextField(
            controller: _code,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            autofocus: true,
            style: const TextStyle(fontSize: 24, letterSpacing: 10, fontWeight: FontWeight.w800),
            decoration: const InputDecoration(
              counterText: '',
              hintText: '••••••',
              labelText: 'Kode autentikasi',
            ),
            onSubmitted: (_) => _verify(),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _verify,
            child: _busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                  )
                : const Text('Verifikasi'),
          ),
          TextButton(
            onPressed: () => widget.app.cancelMfaStep(),
            child: const Text('Kembali ke form login'),
          ),
        ],
      ),
    );
  }
}

/// Pemilih workspace — akun anggota beberapa perusahaan.
class _WorkspacePicker extends StatelessWidget {
  final AppState app;
  const _WorkspacePicker({required this.app});

  Future<void> _pick(BuildContext context, Workspace w) async {
    final messenger = ScaffoldMessenger.of(context);
    final err = await app.selectWorkspace(w.id);
    if (err != null) {
      messenger.showSnackBar(SnackBar(
        content: Text(err),
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 40,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Pilih Workspace',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.deepInk),
          ),
          const SizedBox(height: 4),
          const Text(
            'Akunmu terhubung ke beberapa perusahaan',
            style: TextStyle(fontSize: 12.5, color: Colors.black45),
          ),
          const SizedBox(height: 18),
          for (final w in app.pendingWorkspaces)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: OutlinedButton.icon(
                onPressed: () => _pick(context, w),
                icon: CircleAvatar(
                  backgroundColor: const Color(0xFF059669).withValues(alpha: 0.12),
                  child: Text(
                    (w.companyCode ?? w.name).isNotEmpty
                        ? (w.companyCode ?? w.name).substring(0, 1).toUpperCase()
                        : '?',
                    style: const TextStyle(color: Color(0xFF059669), fontWeight: FontWeight.w900),
                  ),
                ),
                label: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(w.name, style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text(
                      'Peran: ${w.role}',
                      style: const TextStyle(fontSize: 11.5, color: Colors.black45),
                    ),
                  ],
                ),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  alignment: Alignment.centerLeft,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
