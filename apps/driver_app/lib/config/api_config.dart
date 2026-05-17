import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

import 'env.dart';

/// API base URL 的單一決策點。
///
/// 規則（由上而下，第一個成立的就用）：
///   1. **Web 永遠用 localhost**：即使 `--dart-define=API_BASE_URL=...` 傳了 `10.0.2.2`
///      （那是 Android emulator 的虛擬 host loopback，瀏覽器不認得），也忽略它。
///      但允許 Web 環境傳真實網域，例如 `https://api.sigmile.dev`。
///   2. 其他平台：尊重 `--dart-define=API_BASE_URL=...`
///   3. 無 env 時 fallback：
///        Android → `http://10.0.2.2:3000`
///        其它    → `http://localhost:3000`
class ApiConfig {
  static const _webDefault = 'http://localhost:3000';
  static const _androidEmulatorDefault = 'http://10.0.2.2:3000';
  static const _hostLoopbackDefault = 'http://localhost:3000';

  static String resolveBaseUrl() {
    final envUrl = Env.apiBaseUrl.trim();

    if (kIsWeb) {
      // 瀏覽器永遠不能用 10.0.2.2
      if (envUrl.isNotEmpty && !envUrl.contains('10.0.2.2')) {
        return envUrl;
      }
      if (envUrl.contains('10.0.2.2')) {
        debugPrint(
          '[api-config] WARN: env API_BASE_URL=$envUrl 含 10.0.2.2 但目前是 Web，已自動改為 $_webDefault',
        );
      }
      return _webDefault;
    }

    if (envUrl.isNotEmpty) return envUrl;

    try {
      if (Platform.isAndroid) return _androidEmulatorDefault;
    } catch (_) {/* 非支援 dart:io 的平台 */}
    return _hostLoopbackDefault;
  }
}
