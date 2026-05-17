import 'api_client.dart';

/// 位置回報。MVP 走 Next.js API；未來換 background GPS 時 service 介面不變，
/// 只要在背景任務裡呼叫 `updateCurrentLocation(...)` 即可。
class DriverLocationService {
  final ApiClient _api;
  DriverLocationService(this._api);

  Future<void> updateCurrentLocation({
    required double lat,
    required double lng,
    double? accuracyMeters,
    String? deliveryTaskId,
  }) async {
    await _api.post('/api/driver/location', body: {
      'lat': lat,
      'lng': lng,
      if (accuracyMeters != null) 'accuracy_meters': accuracyMeters,
      if (deliveryTaskId != null) 'delivery_task_id': deliveryTaskId,
    });
  }

  /// 用來示範：產生在「雙北中央配送中心」附近 ±0.01° 的 mock 點。
  ({double lat, double lng}) mockLatLng() {
    final r = DateTime.now().millisecondsSinceEpoch % 1000;
    final jitter = (r - 500) / 50000.0; // ±0.01
    return (lat: 25.0610 + jitter, lng: 121.4847 + jitter);
  }
}
