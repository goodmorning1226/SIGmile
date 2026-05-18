import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/stop.dart';
import 'tomtom_routes_service.dart';

/// 跳到外部地圖 app 啟動 turn-by-turn 導航（備援抓手）。
///
/// 定位策略（v0.3）：
///   1. **先用 TomTom Geocoding 把「店名 + 地址」查成精確 lat/lng**
///      → 解決 seed 座標約值偏移問題
///   2. **再用 lat/lng 走 `google.navigation:q=lat,lng&mode=d`**
///      → 直接進 turn-by-turn navigation（**不用按 Start**）
///      （`q=text` 會觸發 Google 搜尋結果列表，要按 Start，所以**一定要 lat/lng**）
///   3. Geocoding 失敗時 fallback 到 seed lat/lng；都沒有就放棄
class ExternalNavigationLauncher {
  final TomTomRoutesService? geocoder;

  ExternalNavigationLauncher({this.geocoder});

  /// Geocode 結果快取（避免同一站重複查）
  final Map<String, ({double lat, double lng})> _cache = {};

  Future<bool> launchTo(Stop stop) async {
    final coords = await _resolveCoords(stop);
    if (coords == null) {
      debugPrint('[ext-nav] ${stop.name} 沒法解析座標');
      return false;
    }
    final lat = coords.lat;
    final lng = coords.lng;

    // ───── Android：google.navigation:q=lat,lng&mode=d → 直接 turn-by-turn
    //   ★ 不能用 q=text，否則 Google 會跑搜尋結果列表 + 要按 Start
    if (!kIsWeb && Platform.isAndroid) {
      final intentUri = Uri.parse('google.navigation:q=$lat,$lng&mode=d');
      debugPrint('[ext-nav] android direct nav: $intentUri');
      if (await canLaunchUrl(intentUri)) {
        return launchUrl(intentUri, mode: LaunchMode.externalApplication);
      }
    }

    // ───── iOS：comgooglemaps URL scheme（限制：iOS 沒有 direct-nav scheme，
    //   一律進 directions preview，要按 Start。這是 Google 政策）
    if (!kIsWeb && Platform.isIOS) {
      final scheme = Uri.parse(
        'comgooglemaps://?daddr=$lat,$lng&directionsmode=driving',
      );
      if (await canLaunchUrl(scheme)) {
        return launchUrl(scheme, mode: LaunchMode.externalApplication);
      }
    }

    // ───── 全平台 fallback：universal HTTPS（也是 preview，無法直接 nav）─────
    final universal = Uri.https('www.google.com', '/maps/dir/', {
      'api': '1',
      'destination': '$lat,$lng',
      'travelmode': 'driving',
    });
    debugPrint('[ext-nav] universal: $universal');
    return launchUrl(universal, mode: LaunchMode.externalApplication);
  }

  /// 取得「最精確的座標」：先 geocode 拿真實門市，失敗才退 seed lat/lng。
  Future<({double lat, double lng})?> _resolveCoords(Stop stop) async {
    final cacheKey = stop.id;
    final cached = _cache[cacheKey];
    if (cached != null) return cached;

    final name = stop.name.trim();
    final address = stop.address.trim();
    final query = [
      if (name.isNotEmpty) name,
      if (address.isNotEmpty) address,
    ].join(' ');

    // 1) TomTom geocode（最精確）
    if (geocoder != null && query.isNotEmpty) {
      final geo = await geocoder!.geocode(query);
      if (geo != null) {
        _cache[cacheKey] = geo;
        return geo;
      }
    }

    // 2) Seed lat/lng fallback
    final lat = stop.lat;
    final lng = stop.lng;
    if (lat != null && lng != null) {
      final fallback = (lat: lat, lng: lng);
      _cache[cacheKey] = fallback;
      return fallback;
    }

    return null;
  }
}
