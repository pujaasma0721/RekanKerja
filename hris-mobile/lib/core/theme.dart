import 'package:flutter/material.dart';

/// OneVity HRIS Mobile — Design System
/// Employee-centric: hangat, hidup, dan modern (nuansa fintech).
/// - Seed emerald (identitas OneVity) + aksen amber utk aksi utama
/// - Kartu membulat 20-24, soft shadow, latar warm-stone
/// - Tipografi angka besar & tebal utk nominal (gaya dompet digital)
class AppTheme {
  static const Color seed = Color(0xFF059669); // emerald 600
  static const Color accent = Color(0xFFF59E0B); // amber 500
  static const Color deepInk = Color(0xFF1C2B26);

  static const LinearGradient heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF047857), Color(0xFF059669), Color(0xFF0DA27E)],
  );

  static const LinearGradient accentGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFD97706), Color(0xFFF59E0B)],
  );

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.light,
    );
    return _base(scheme.copyWith(
      surface: Colors.white,
      surfaceContainerLowest: Colors.white,
    ));
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark,
    );
    return _base(scheme);
  }

  static ThemeData _base(ColorScheme scheme) {
    final isDark = scheme.brightness == Brightness.dark;
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor:
          isDark ? const Color(0xFF0D1210) : const Color(0xFFF6F7F3),
      appBarTheme: AppBarTheme(
        centerTitle: true,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w800,
          color: scheme.onSurface,
        ),
        iconTheme: IconThemeData(color: scheme.onSurface),
      ),
      cardTheme: CardThemeData(
        color: scheme.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: isDark
              ? BorderSide(color: Colors.white.withValues(alpha: 0.06))
              : BorderSide(color: Colors.black.withValues(alpha: 0.05)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          minimumSize: const Size.fromHeight(52),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: scheme.primary,
          minimumSize: const Size.fromHeight(52),
          side: BorderSide(color: scheme.primary.withValues(alpha: 0.5)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? Colors.white.withValues(alpha: 0.05) : Colors.black.withValues(alpha: 0.035),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
        hintStyle: TextStyle(
          color: isDark ? Colors.white38 : Colors.black38,
          fontWeight: FontWeight.w500,
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: accent,
        foregroundColor: Colors.white,
        elevation: 3,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? const Color(0xFF161C19) : Colors.white,
        modalBackgroundColor: isDark ? const Color(0xFF161C19) : Colors.white,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isDark ? const Color(0xFF1E2521) : deepInk,
        contentTextStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      dividerTheme: DividerThemeData(
        color: isDark ? Colors.white.withValues(alpha: 0.07) : Colors.black.withValues(alpha: 0.06),
        thickness: 1,
        space: 1,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) {
          if (s.contains(WidgetState.selected)) return Colors.white;
          return isDark ? Colors.grey : Colors.white;
        }),
        trackColor: WidgetStateProperty.resolveWith((s) {
          if (s.contains(WidgetState.selected)) return scheme.primary;
          return isDark ? Colors.white24 : Colors.black12;
        }),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark ? const Color(0xFF121714) : Colors.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primary.withValues(alpha: 0.12),
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(
            size: 24,
            color: s.contains(WidgetState.selected)
                ? scheme.primary
                : isDark
                    ? Colors.white38
                    : Colors.black38,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (s) => TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: s.contains(WidgetState.selected)
                ? scheme.primary
                : isDark
                    ? Colors.white38
                    : Colors.black38,
          ),
        ),
      ),
      listTileTheme: ListTileThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        iconColor: scheme.primary,
      ),
    );
  }
}

/// Warna semantik status pengajuan (disetujui / menunggu / dst).
class StatusColors {
  static const Map<String, (Color, Color)> _map = {
    'approved': (Color(0xFF059669), Color(0xFFECFDF5)),
    'pending': (Color(0xFFB45309), Color(0xFFFEF3C7)),
    'rejected': (Color(0xFFBE123C), Color(0xFFFFE4E6)),
    'submitted': (Color(0xFF0369A1), Color(0xFFE0F2FE)),
    'done': (Color(0xFF4338CA), Color(0xFFE0E7FF)),
    'cancelled': (Color(0xFF57534E), Color(0xFFF5F5F4)),
  };

  /// (foreground, background) — latar otomatis diterangkan di dark mode.
  static (Color, Color) of(String status, {bool dark = false}) {
    final (fg, bg) = _map[status] ?? _map['pending']!;
    if (!dark) return (fg, bg);
    int brighten(double channel) => (channel * 1.4).clamp(0.0, 255.0).toInt();
    Color lift(Color c) => Color.fromARGB(
          (c.a * 255.0).round().clamp(0, 255),
          brighten(c.r * 255.0),
          brighten(c.g * 255.0),
          brighten(c.b * 255.0),
        );
    return (fg, lift(bg).withValues(alpha: 0.16));
  }
}
