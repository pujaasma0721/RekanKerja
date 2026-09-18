import 'package:flutter/material.dart';

/// Format nominal Rupiah gaya Indonesia: 8500000 → "Rp 8.500.000"
String rupiah(num v, {bool withSymbol = true}) {
  final neg = v < 0;
  final s = v.round().abs().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    b.write(s[i]);
    final rem = s.length - 1 - i;
    if (rem > 0 && rem % 3 == 0) b.write('.');
  }
  return '${withSymbol ? 'Rp ' : ''}${neg ? '-' : ''}$b';
}

/// 450 menit → "7j 30m"
String durasi(int minutes) {
  final h = minutes ~/ 60;
  final m = minutes % 60;
  if (h == 0) return '$m menit';
  if (m == 0) return '$h jam';
  return '$h jam $m mnt';
}

const List<String> hariID = [
  'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu',
];
const List<String> bulanID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/// 2026-09-18 → "18 September 2026"
String tanggalID(DateTime d, {bool withDay = false}) {
  final wd = hariID[d.weekday - 1];
  final base = '${d.day} ${bulanID[d.month - 1]} ${d.year}';
  return withDay ? '$wd, $base' : base;
}

/// 2026-09 → "September 2026"
String periodeID(int year, int month) => '${bulanID[month - 1]} $year';

/// 14:35 (TimeOfDay) → "14.35" (gaya ID)
String jamID(TimeOfDay t) =>
    '${t.hour.toString().padLeft(2, '0')}.${t.minute.toString().padLeft(2, '0')}';

String jam2(DateTime d) =>
    '${d.hour.toString().padLeft(2, '0')}.${d.minute.toString().padLeft(2, '0')}';

/// Relatif ramah: "2 jam lalu", "3 hari lalu", "baru saja".
String relatif(DateTime t) {
  final diff = DateTime.now().difference(t);
  if (diff.inMinutes < 1) return 'baru saja';
  if (diff.inMinutes < 60) return '${diff.inMinutes} mnt lalu';
  if (diff.inHours < 24) return '${diff.inHours} jam lalu';
  if (diff.inDays < 7) return '${diff.inDays} hari lalu';
  return tanggalID(t);
}

/// Inisial nama utk avatar (maks 2 huruf).
String inisial(String nama) {
  final parts = nama.trim().split(RegExp(r'\s+'));
  if (parts.length == 1) return parts.first.substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/// Warna avatar konsisten per nama.
Color avatarColor(String nama) {
  const palette = [
    Color(0xFF059669), Color(0xFF0284C7), Color(0xFF7C3AED),
    Color(0xFFDB2777), Color(0xFFEA580C), Color(0xFF0891B2),
    Color(0xFF65A30D), Color(0xFF4F46E5),
  ];
  int h = 0;
  for (final c in nama.codeUnits) {
    h = (h * 31 + c) & 0x7fffffff;
  }
  return palette[h % palette.length];
}

/// Sapaan waktu Indonesia.
String sapaan(DateTime now) {
  if (now.hour < 11) return 'Selamat pagi';
  if (now.hour < 15) return 'Selamat siang';
  if (now.hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}
