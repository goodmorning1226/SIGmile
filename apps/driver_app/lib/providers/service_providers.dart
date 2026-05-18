import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/api_config.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/driver_location_service.dart';
import '../services/driver_task_service.dart';
import '../services/external_navigation_launcher.dart';
import '../services/tomtom_routes_service.dart';
import '../services/voice_navigation_service.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  final url = ApiConfig.resolveBaseUrl();
  debugPrint('[api] base URL = $url');
  return ApiClient(url);
});

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

final driverTaskServiceProvider = Provider<DriverTaskService>((ref) {
  return DriverTaskService(ref.watch(apiClientProvider));
});

final driverLocationServiceProvider = Provider<DriverLocationService>((ref) {
  return DriverLocationService(ref.watch(apiClientProvider));
});

/// TomTom Maps + Routing API。沒設 key 也會建出來（fallback 成直線估算）。
final tomtomRoutesServiceProvider = Provider<TomTomRoutesService>(
  (ref) => TomTomRoutesService(),
);

/// 跳外部地圖 app 的備援抓手（要 turn-by-turn 語音時讓 driver 切過去）。
/// 注入 TomTom geocoder：把 seed 約值座標查成精確門市座標。
final externalNavLauncherProvider = Provider<ExternalNavigationLauncher>(
  (ref) => ExternalNavigationLauncher(
    geocoder: ref.watch(tomtomRoutesServiceProvider),
  ),
);

/// 系統 TTS 包裝，給 TomTomMapView 念 turn-by-turn instructions。
/// keepAlive：整個 app 生命週期共用一個實例（避免 TTS 重複初始化）
final voiceNavigationServiceProvider = Provider<VoiceNavigationService>((ref) {
  final svc = VoiceNavigationService();
  ref.onDispose(svc.stop);
  return svc;
});
