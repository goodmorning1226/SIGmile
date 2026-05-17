import '../models/stop.dart';

/// 導航服務介面 + MVP placeholder 實作。
///
/// ★ 設計轉變（v0.2）★
///   - 以前：openNavigation 會跳出外部 Google Maps URL
///   - 現在：導航完全在 App 內呈現（NavigationMapPage），這個 service 只負責提供
///           **資料**（ETA、預計路線、之後的 turn-by-turn instructions）
///
/// 未來換成 Google Maps Navigation SDK 時：
///   - estimateTravelTime  → 呼叫 Google Routes API
///   - prepareRoute        → 取得 polyline、turn-by-turn 指令
///   - NavigationMapPage 內把 MapPlaceholder 換成 `GoogleMap` widget
abstract class NavigationService {
  /// 估算從 (fromLat,fromLng) 到 (toLat,toLng) 的行車時間。
  /// 未串接時回 null。
  Future<Duration?> estimateTravelTime({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
  });

  /// 準備一次導航 session 的資料（之後 NavigationMapPage 會吃這個）。
  /// MVP：固定回 null（讓 UI 用預設的佔位畫面）。
  Future<NavigationSession?> prepareRoute({
    required double fromLat,
    required double fromLng,
    required Stop destination,
  });
}

/// 未來真的接 Google Maps 時擴充此類別。
class NavigationSession {
  final List<({double lat, double lng})> polyline;
  final Duration estimatedDuration;
  final double distanceMeters;

  const NavigationSession({
    required this.polyline,
    required this.estimatedDuration,
    required this.distanceMeters,
  });
}

class MockNavigationService implements NavigationService {
  @override
  Future<Duration?> estimateTravelTime({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
  }) async {
    return null;
  }

  @override
  Future<NavigationSession?> prepareRoute({
    required double fromLat,
    required double fromLng,
    required Stop destination,
  }) async {
    return null;
  }
}
