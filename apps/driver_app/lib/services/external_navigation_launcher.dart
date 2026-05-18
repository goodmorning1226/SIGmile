import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/stop.dart';

/// 跳到外部地圖 app 啟動 turn-by-turn 導航（備援抓手）。
///
/// 為什麼留這條路：
///   - TomTom Routing API 只回路線資料，App 內**不提供 turn-by-turn 語音**
///   - 司機真要駕駛時，跳系統 Google Maps（或 TomTom GO）體驗最穩、最免費
///   - 物流業實際做法：App 管任務狀態，駕駛交給專門的 navigation app
///
/// Android：用 `google.navigation:q=lat,lng&mode=d` intent（系統 chooser 會列出
///          所有支援的 navigation app；Google Maps / TomTom GO / Waze 都接得到）
/// iOS：    優先 `comgooglemaps://`；沒裝 fallback 到 Google Maps universal link
/// Web：    開新分頁打 Google Maps universal link
class ExternalNavigationLauncher {
  Future<bool> launchTo(Stop stop) async {
    final lat = stop.lat;
    final lng = stop.lng;
    if (lat == null || lng == null) {
      debugPrint('[ext-nav] ${stop.name} 沒有座標');
      return false;
    }

    if (!kIsWeb && Platform.isAndroid) {
      final intent = Uri.parse('google.navigation:q=$lat,$lng&mode=d');
      if (await canLaunchUrl(intent)) {
        return launchUrl(intent, mode: LaunchMode.externalApplication);
      }
    }

    if (!kIsWeb && Platform.isIOS) {
      final scheme = Uri.parse(
        'comgooglemaps://?daddr=$lat,$lng&directionsmode=driving',
      );
      if (await canLaunchUrl(scheme)) {
        return launchUrl(scheme, mode: LaunchMode.externalApplication);
      }
    }

    // 全平台 fallback
    final universal = Uri.parse(
      'https://www.google.com/maps/dir/?api=1'
      '&destination=$lat,$lng'
      '&travelmode=driving',
    );
    return launchUrl(universal, mode: LaunchMode.externalApplication);
  }
}
