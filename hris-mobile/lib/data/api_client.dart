import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Client HTTP tipis untuk backend OneVity.
///
/// Autentikasi memakai cookie sesi `onevity_session` (sama seperti web):
///  - login / verify MFA / select-tenant / auth-me merespon `Set-Cookie` —
///    nilai cookie terbaru otomatis ditangkap di sini;
///  - setiap request berikutnya mengirim kembali cookie tersebut.
class ApiClient {
  /// Base URL backend. Default: produksi OneVity.
  /// Bisa dioverride lewat --dart-define=ONEVITY_API=... atau
  /// dialog pengaturan server (long-press logo di halaman login).
  static const String prodBaseUrl = String.fromEnvironment(
    'ONEVITY_API',
    defaultValue: 'https://onevity.sayone.my.id',
  );

  String baseUrl;
  String? sessionCookie;

  ApiClient({String? baseUrl}) : baseUrl = (baseUrl == null || baseUrl.isEmpty) ? prodBaseUrl : baseUrl;

  static const _timeout = Duration(seconds: 25);

/// Tangkap cookie sesi terbaru dari header `set-cookie`.
/// (Paket http menggabungkan beberapa Set-Cookie dengan koma —
///  nilai token sesi sendiri hanya base64url + titik sehingga aman di-split.)
  void _captureCookie(http.Response res) {
    final raw = res.headers['set-cookie'];
    if (raw == null || raw.isEmpty) return;
    for (final cookieHeader in raw.split(',')) {
      final first = cookieHeader.split(';').first.trim();
      final eq = first.indexOf('=');
      if (eq <= 0) continue;
      final name = first.substring(0, eq).trim();
      final value = first.substring(eq + 1).trim();
      if (name == 'onevity_session' && value.isNotEmpty) {
        sessionCookie = value;
      }
    }
  }

  Map<String, String> get _headers => {
        'accept': 'application/json',
        if (sessionCookie != null) 'cookie': 'onevity_session=$sessionCookie',
      };

  Uri _uri(String path, [Map<String, String>? query]) {
    var u = Uri.parse('$baseUrl$path');
    if (query != null && query.isNotEmpty) u = u.replace(queryParameters: query);
    return u;
  }

  Future<Map<String, dynamic>> getJson(String path, [Map<String, String>? query]) async {
    try {
      final res = await http.get(_uri(path, query), headers: _headers).timeout(_timeout);
      return _decode(res);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(0, 'Server tidak merespons — periksa koneksi internetmu.');
    } catch (_) {
      throw ApiException(0, 'Tidak dapat terhubung ke server ($baseUrl).');
    }
  }

  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> data) =>
      _send('POST', path, data);

  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> data) =>
      _send('PATCH', path, data);

  Future<Map<String, dynamic>> _send(String method, String path, Map<String, dynamic> data) async {
    try {
      final req = http.Request(method, _uri(path))
        ..headers.addAll(_headers)
        ..headers['content-type'] = 'application/json'
        ..body = jsonEncode(data);
      final streamed = await req.send().timeout(_timeout);
      final res = await http.Response.fromStream(streamed);
      return _decode(res);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(0, 'Server tidak merespons — periksa koneksi internetmu.');
    } catch (_) {
      throw ApiException(0, 'Tidak dapat terhubung ke server ($baseUrl).');
    }
  }

  /// Unduh berkas biner (PDF surat resmi) — membawa cookie sesi.
  Future<http.Response> getRaw(String path, [Map<String, String>? query]) async {
    try {
      final res = await http.get(_uri(path, query), headers: _headers).timeout(_timeout);
      if (res.statusCode >= 400) {
        throw ApiException(res.statusCode, 'Gagal mengunduh dokumen (HTTP ${res.statusCode}).');
      }
      return res;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(0, 'Server tidak merespons saat mengunduh dokumen.');
    } catch (_) {
      throw ApiException(0, 'Tidak dapat terhubung ke server.');
    }
  }

  Map<String, dynamic> _decode(http.Response res) {
    _captureCookie(res);
    dynamic body;
    try {
      body = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 400) {
      final msg = body is Map && body['error'] != null
          ? body['error'].toString()
          : 'Terjadi kesalahan (HTTP ${res.statusCode}).';
      throw ApiException(res.statusCode, msg);
    }
    if (body is! Map<String, dynamic>) {
      throw ApiException(res.statusCode, 'Respon server tidak dikenali.');
    }
    return body;
  }
}

/// Error aplikasi dari sisi API — pesan sudah ramah bahasa Indonesia
/// (diutamakan dari field `error` backend).
class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);

  /// Sesi tamat → perlu login ulang.
  bool get unauthorized => status == 401;

  @override
  String toString() => message;
}
