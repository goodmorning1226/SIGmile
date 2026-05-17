import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

/// 包一層 http：
///   - 自動把 Supabase access_token 塞進 `Authorization: Bearer ...`
///   - 自動 JSON encode / decode
///   - 解開 Next.js 統一回傳格式 `{ success: bool, data | error }`
class ApiClient {
  final String baseUrl;
  final Duration timeout;
  final http.Client _http;

  ApiClient(
    this.baseUrl, {
    Duration? timeout,
    http.Client? client,
  })  : timeout = timeout ?? const Duration(seconds: 30),
        _http = client ?? http.Client();

  String? get _accessToken =>
      Supabase.instance.client.auth.currentSession?.accessToken;

  Uri _u(String path) {
    final base = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    final p = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$base$p');
  }

  Map<String, String> _headers() {
    final token = _accessToken;
    return {
      'content-type': 'application/json',
      'accept': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> get(String path) async {
    final uri = _u(path);
    try {
      final res = await _http
          .get(uri, headers: _headers())
          .timeout(timeout);
      return _unwrap(uri, res);
    } on ApiException {
      rethrow;
    } on Exception catch (e) {
      throw ApiException(_networkErrorMessage(uri, e), statusCode: 0);
    }
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = _u(path);
    try {
      final res = await _http
          .post(
            uri,
            headers: _headers(),
            body: body == null ? null : jsonEncode(body),
          )
          .timeout(timeout);
      return _unwrap(uri, res);
    } on ApiException {
      rethrow;
    } on Exception catch (e) {
      throw ApiException(_networkErrorMessage(uri, e), statusCode: 0);
    }
  }

  Map<String, dynamic> _unwrap(Uri uri, http.Response res) {
    // 1. 嘗試解析 JSON
    Map<String, dynamic>? json;
    try {
      if (res.body.isNotEmpty) {
        final parsed = jsonDecode(res.body);
        if (parsed is Map<String, dynamic>) json = parsed;
      }
    } catch (_) {
      /* 非 JSON 回應，下面用 status code + body 抛 */
    }

    // 2. HTTP 失敗 → 把 status + body 都寫進錯誤訊息
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final apiErr = (json?['error'] ?? '').toString();
      final bodyPreview = res.body.length > 200
          ? '${res.body.substring(0, 200)}…'
          : res.body;
      throw ApiException(
        'HTTP ${res.statusCode} @ $uri'
        '${apiErr.isNotEmpty ? "\n伺服器訊息：$apiErr" : ""}'
        '${json == null && bodyPreview.isNotEmpty ? "\n回應內容：$bodyPreview" : ""}',
        statusCode: res.statusCode,
      );
    }

    // 3. 200 但 success != true
    if (json == null) {
      throw ApiException(
        'HTTP 200 但非 JSON 回應 @ $uri',
        statusCode: res.statusCode,
      );
    }
    if (json['success'] != true) {
      throw ApiException(
        '${json['error'] ?? "未知錯誤"} @ $uri',
        statusCode: res.statusCode,
      );
    }

    final data = json['data'];
    if (data is Map<String, dynamic>) return data;
    return {'value': data};
  }

  /// 區分常見網路錯誤型態，給使用者更精準的線索
  String _networkErrorMessage(Uri uri, Exception e) {
    final raw = e.toString();
    final hint = _hintFor(raw);
    return 'API 連線失敗：$uri\n原因：$raw${hint.isNotEmpty ? "\n👉 $hint" : ""}';
  }

  String _hintFor(String raw) {
    final lower = raw.toLowerCase();
    if (lower.contains('timeout')) {
      return 'Next.js 可能首次編譯該路由還沒完成（dev mode 常 10–20 秒），再試一次或檢查後端 console';
    }
    if (lower.contains('failed to fetch') ||
        lower.contains('clientexception') && lower.contains('failed to fetch')) {
      return 'Flutter Web 跨來源被擋。請確認：\n   ①  Next.js dev server 已啟動（npm run dev）\n   ②  middleware 已加入 CORS（後端最新版本）\n   ③  API_BASE_URL 對應目前環境（Web/iOS Sim 用 localhost、Android 模擬器用 10.0.2.2）';
    }
    if (lower.contains('connection refused') || lower.contains('errno = 111') || lower.contains('111')) {
      return '後端拒絕連線，請確認 Next.js 還在跑且 port 3000 正確';
    }
    if (lower.contains('host lookup') || lower.contains('failed host lookup')) {
      return '無法解析主機名，請檢查 API_BASE_URL 拼字';
    }
    if (lower.contains('cleartext')) {
      return 'Android 9+ 預設禁止純 HTTP，請在 AndroidManifest.xml 加 android:usesCleartextTraffic="true"';
    }
    return '';
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  ApiException(this.message, {required this.statusCode});

  bool get isAuth => statusCode == 401 || statusCode == 403;
  bool get isNetwork => statusCode == 0;

  @override
  String toString() => message;
}
