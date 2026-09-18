import 'package:flutter/material.dart';

import 'format.dart';
import 'theme.dart';

/// ============ Widget dasar reusable seluruh app ============

class PaddedPage extends StatelessWidget {
  final Widget child;
  final ScrollPhysics? physics;
  final EdgeInsets extra;
  const PaddedPage({super.key, required this.child, this.physics, this.extra = EdgeInsets.zero});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListView(
        physics: physics,
        padding: EdgeInsets.fromLTRB(20, 12,  20, 120 + extra.bottom),
        children: [child],
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  final String title;
  final String? action;
  final VoidCallback? onAction;
  const SectionTitle(this.title, {super.key, this.action, this.onAction});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 22, bottom: 12),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: -0.2),
            ),
          ),
          if (action != null)
            GestureDetector(
              onTap: onAction,
              child: Text(
                action!,
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.seed,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class AppAvatar extends StatelessWidget {
  final String nama;
  final double size;
  const AppAvatar(this.nama, {super.key, this.size = 44});

  @override
  Widget build(BuildContext context) {
    final c = avatarColor(nama);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [c, c.withValues(alpha: 0.72)],
        ),
        borderRadius: BorderRadius.circular(size * 0.34),
      ),
      alignment: Alignment.center,
      child: Text(
        inisial(nama),
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
          fontSize: size * 0.36,
          letterSpacing: -0.5,
        ),
      ),
    );
  }
}

/// Chip status pengajuan: approved / pending / rejected / dst.
class StatusChip extends StatelessWidget {
  final String status;
  final bool compact;
  const StatusChip(this.status, {super.key, this.compact = false});

  static const labels = {
    'approved': 'Disetujui',
    'pending': 'Menunggu',
    'rejected': 'Ditolak',
    'submitted': 'Terkirim',
    'done': 'Selesai',
    'cancelled': 'Dibatalkan',
  };

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (fg, bg) = StatusColors.of(status, dark: dark);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 8 : 10, vertical: compact ? 3 : 5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(
        labels[status] ?? status,
        style: TextStyle(fontSize: compact ? 10 : 11, fontWeight: FontWeight.w800, color: fg),
      ),
    );
  }
}

/// Nominal uang dengan penghormatan mode privasi (disembunyikan).
class MoneyText extends StatelessWidget {
  final int amount;
  final TextStyle? style;
  final bool privacy;
  const MoneyText(this.amount, {super.key, this.style, this.privacy = false});

  @override
  Widget build(BuildContext context) {
    final privacyOn = privacy;
    if (privacyOn) {
      return Text('Rp ••••••',
          style: (style ?? const TextStyle()).copyWith(
            letterSpacing: 1,
          ));
    }
    return Text(rupiah(amount), style: style);
  }
}

class _RingPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color track;
  final double stroke;
  _RingPainter(this.progress, this.color, this.track, this.stroke);

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.shortestSide - stroke) / 2;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    paint.color = track;
    canvas.drawCircle(center, radius, paint);
    paint.color = color;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -1.5708,
      progress * 6.2832,
      false,
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.progress != progress || old.color != color;
}

class Ring extends StatelessWidget {
  final double progress; // 0..1
  final double size;
  final double stroke;
  final Color? color;
  final Widget? child;
  const Ring({super.key, required this.progress, this.size = 84, this.stroke = 8, this.color, this.child});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(
          progress.clamp(0, 1),
          color ?? Theme.of(context).colorScheme.primary,
          dark ? Colors.white12 : Colors.black.withValues(alpha: 0.06),
          stroke,
        ),
        child: Center(child: child),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const EmptyState({super.key, required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 42, horizontal: 24),
        child: Column(
          children: [
            Container(
              width: 68,
              height: 68,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 30, color: Theme.of(context).colorScheme.primary),
            ),
            const SizedBox(height: 16),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: Theme.of(context).hintColor),
            ),
          ],
        ),
      ),
    );
  }
}

/// Header bawah-sheet seragam.
class SheetHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  const SheetHeader(this.title, {super.key, this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: TextStyle(fontSize: 12.5, color: Theme.of(context).hintColor)),
          ],
        ],
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String value;
  final String label;
  final VoidCallback? onTap;
  const StatTile({super.key, required this.icon, required this.color, required this.value, required this.label, this.onTap});

  @override
  Widget build(BuildContext context) {
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, size: 17, color: color),
            ),
            const SizedBox(height: 10),
            Text(value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData? icon;
  const InfoRow(this.label, this.value, {super.key, this.icon});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 11),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18, color: Theme.of(context).hintColor),
            const SizedBox(width: 10),
          ],
          Text(label, style: TextStyle(fontSize: 13, color: Theme.of(context).hintColor, fontWeight: FontWeight.w600)),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// Tombol aksi cepat di dashboard/grid pengajuan.
class QuickAction extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;
  const QuickAction({super.key, required this.icon, required this.color, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
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
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [color.withValues(alpha: 0.16), color.withValues(alpha: 0.07)],
                ),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(height: 9),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, height: 1.15),
            ),
          ],
        ),
      ),
    );
  }
}

/// Timeline persetujuan berjenjang (khas OneVity).
class ApprovalTimeline extends StatelessWidget {
  final List<ApprovalStepMV> steps;
  const ApprovalTimeline(this.steps, {super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        for (int i = 0; i < steps.length; i++) ...[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: 26,
                    height: 26,
                    decoration: BoxDecoration(
                      color: steps[i].status == 'approved'
                          ? scheme.primary
                          : steps[i].status == 'rejected'
                              ? StatusColors.of('rejected').$1
                              : (Theme.of(context).brightness == Brightness.dark ? Colors.white12 : Colors.black.withValues(alpha: 0.06)),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      steps[i].status == 'approved'
                          ? Icons.check_rounded
                          : steps[i].status == 'rejected'
                              ? Icons.close_rounded
                              : Icons.schedule_rounded,
                      size: 15,
                      color: steps[i].status == 'approved' || steps[i].status == 'rejected' ? Colors.white : Theme.of(context).hintColor,
                    ),
                  ),
                  if (i < steps.length - 1)
                    Container(width: 2, height: 22, color: Theme.of(context).brightness == Brightness.dark ? Colors.white10 : Colors.black.withValues(alpha: 0.07)),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${steps[i].role} — ${steps[i].name}',
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                      StatusChip(steps[i].status, compact: true),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (i < steps.length - 1) const SizedBox(height: 4),
        ],
      ],
    );
  }
}

/// Model langkah persetujuan (dipisah di sini agar widget file mandiri).
class ApprovalStepMV {
  final String role;
  final String name;
  final String status;
  ApprovalStepMV(this.role, this.name, this.status);
}
