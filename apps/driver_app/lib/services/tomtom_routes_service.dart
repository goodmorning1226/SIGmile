import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import '../config/env.dart';
import '../models/stop.dart';

/// TomTom guidance.instructions 對應的 maneuver 列舉（含完整 34 種）。
/// 文件：https://developer.tomtom.com/routing-api/documentation/tomtom-maps/guidance-instructions
enum RouteManeuver {
  depart,
  arrive,
  arriveLeft,
  arriveRight,
  straight,
  keepLeft,
  keepRight,
  bearLeft,
  bearRight,
  turnLeft,
  turnRight,
  sharpLeft,
  sharpRight,
  makeUTurn,
  tryMakeUTurn,
  follow,
  enterMotorway,
  enterFreeway,
  enterHighway,
  takeExit,
  motorwayExitLeft,
  motorwayExitRight,
  takeFerry,
  roundaboutCross,
  roundaboutRight,
  roundaboutLeft,
  roundaboutBack,
  switchParallelRoad,
  switchMainRoad,
  entranceRamp,
  waypointLeft,
  waypointRight,
  waypointReached,
  unknown,
}

RouteManeuver _parseManeuver(String? s) {
  switch (s) {
    case 'DEPART':              return RouteManeuver.depart;
    case 'ARRIVE':              return RouteManeuver.arrive;
    case 'ARRIVE_LEFT':         return RouteManeuver.arriveLeft;
    case 'ARRIVE_RIGHT':        return RouteManeuver.arriveRight;
    case 'STRAIGHT':            return RouteManeuver.straight;
    case 'KEEP_LEFT':           return RouteManeuver.keepLeft;
    case 'KEEP_RIGHT':          return RouteManeuver.keepRight;
    case 'BEAR_LEFT':           return RouteManeuver.bearLeft;
    case 'BEAR_RIGHT':          return RouteManeuver.bearRight;
    case 'TURN_LEFT':           return RouteManeuver.turnLeft;
    case 'TURN_RIGHT':          return RouteManeuver.turnRight;
    case 'SHARP_LEFT':          return RouteManeuver.sharpLeft;
    case 'SHARP_RIGHT':         return RouteManeuver.sharpRight;
    case 'MAKE_UTURN':          return RouteManeuver.makeUTurn;
    case 'TRY_MAKE_UTURN':      return RouteManeuver.tryMakeUTurn;
    case 'FOLLOW':              return RouteManeuver.follow;
    case 'ENTER_MOTORWAY':      return RouteManeuver.enterMotorway;
    case 'ENTER_FREEWAY':       return RouteManeuver.enterFreeway;
    case 'ENTER_HIGHWAY':       return RouteManeuver.enterHighway;
    case 'TAKE_EXIT':           return RouteManeuver.takeExit;
    case 'MOTORWAY_EXIT_LEFT':  return RouteManeuver.motorwayExitLeft;
    case 'MOTORWAY_EXIT_RIGHT': return RouteManeuver.motorwayExitRight;
    case 'TAKE_FERRY':          return RouteManeuver.takeFerry;
    case 'ROUNDABOUT_CROSS':    return RouteManeuver.roundaboutCross;
    case 'ROUNDABOUT_RIGHT':    return RouteManeuver.roundaboutRight;
    case 'ROUNDABOUT_LEFT':     return RouteManeuver.roundaboutLeft;
    case 'ROUNDABOUT_BACK':     return RouteManeuver.roundaboutBack;
    case 'SWITCH_PARALLEL_ROAD':return RouteManeuver.switchParallelRoad;
    case 'SWITCH_MAIN_ROAD':    return RouteManeuver.switchMainRoad;
    case 'ENTRANCE_RAMP':       return RouteManeuver.entranceRamp;
    case 'WAYPOINT_LEFT':       return RouteManeuver.waypointLeft;
    case 'WAYPOINT_RIGHT':      return RouteManeuver.waypointRight;
    case 'WAYPOINT_REACHED':    return RouteManeuver.waypointReached;
    default:                    return RouteManeuver.unknown;
  }
}

/// 車道允許 / 推薦的方向（TomTom direction enum）。
enum LaneDirection {
  straight,
  slightRight,
  right,
  sharpRight,
  rightUTurn,
  slightLeft,
  left,
  sharpLeft,
  leftUTurn,
}

LaneDirection? _parseLaneDir(String? s) {
  switch (s) {
    case 'STRAIGHT':     return LaneDirection.straight;
    case 'SLIGHT_RIGHT': return LaneDirection.slightRight;
    case 'RIGHT':        return LaneDirection.right;
    case 'SHARP_RIGHT':  return LaneDirection.sharpRight;
    case 'RIGHT_U_TURN': return LaneDirection.rightUTurn;
    case 'SLIGHT_LEFT':  return LaneDirection.slightLeft;
    case 'LEFT':         return LaneDirection.left;
    case 'SHARP_LEFT':   return LaneDirection.sharpLeft;
    case 'LEFT_U_TURN':  return LaneDirection.leftUTurn;
    default: return null;
  }
}

/// 一條車道：允許的所有方向 + 推薦跟車（圖示應該變亮的那個方向）。
class RouteLane {
  final List<LaneDirection> directions;
  final LaneDirection? follow;
  const RouteLane({required this.directions, this.follow});

  /// 該車道是否「推薦」（高亮顯示）
  bool get isRecommended => follow != null;
}

/// 一段路的車道組合（從 polyline 的 startPointIndex 開始延伸到 endPointIndex）。
class RouteLaneSection {
  final int startPointIndex;
  final int endPointIndex;
  final List<RouteLane> lanes;
  const RouteLaneSection({
    required this.startPointIndex,
    required this.endPointIndex,
    required this.lanes,
  });
}

/// 單一 turn-by-turn 指令。
class RouteInstruction {
  /// 從路線起點累積距離（公尺）
  final double routeOffsetMeters;
  /// 對應 polyline points[] 的索引（用來找對應的 LANES section）
  final int pointIndex;
  final LatLng point;
  final RouteManeuver maneuver;
  /// 人類可讀的指令文字（zh-TW，例如「200 公尺後右轉進入松高路」）
  final String message;
  final String? street;

  const RouteInstruction({
    required this.routeOffsetMeters,
    required this.pointIndex,
    required this.point,
    required this.maneuver,
    required this.message,
    this.street,
  });
}

/// 一次 routing session 的資料：給地圖 widget 畫 polyline + 顯示 ETA / 距離 / 轉彎指令 / 車道指引用。
class RouteSession {
  final List<LatLng> points;
  final List<RouteInstruction> instructions;
  final List<RouteLaneSection> laneSections;
  final Duration estimatedDuration;
  final double distanceMeters;

  /// 是否來自真實 TomTom API（false = 直線 fallback）
  final bool isReal;

  const RouteSession({
    required this.points,
    required this.instructions,
    required this.laneSections,
    required this.estimatedDuration,
    required this.distanceMeters,
    required this.isReal,
  });

  /// 找出某個 instruction 對應的車道組合（用 pointIndex 範圍判定）。
  /// 沒對應就回 null（一般直行路段不會有 lanes section）。
  RouteLaneSection? lanesFor(RouteInstruction ins) {
    for (final s in laneSections) {
      if (ins.pointIndex >= s.startPointIndex &&
          ins.pointIndex <= s.endPointIndex) {
        return s;
      }
    }
    // 找不到精確匹配時，回離 instruction.pointIndex 最近且在前面的 lanes 段
    RouteLaneSection? best;
    int bestDelta = -1;
    for (final s in laneSections) {
      final delta = ins.pointIndex - s.endPointIndex;
      if (delta >= 0 && delta < 5 && (bestDelta < 0 || delta < bestDelta)) {
        best = s;
        bestDelta = delta;
      }
    }
    return best;
  }

  String get formattedEta {
    final m = estimatedDuration.inMinutes;
    if (m < 60) return '$m 分';
    final h = m ~/ 60;
    final mm = m % 60;
    return mm == 0 ? '$h 小時' : '$h 小時 $mm 分';
  }

  String get formattedDistance {
    if (distanceMeters < 1000) {
      return '${distanceMeters.toStringAsFixed(0)} 公尺';
    }
    return '${(distanceMeters / 1000).toStringAsFixed(1)} 公里';
  }
}

/// TomTom Routing API 包裝。
///
/// 設計考量：
///   - **純 REST**：不依賴任何 native SDK，Android/iOS/Web 共用一份程式碼
///   - **點集陣列**：API 直接回 `points: [{latitude, longitude}, ...]`，
///     不用自己解 encoded polyline
///   - **fallback**：沒 key 或 API 掛掉時回直線兩點 + 估算 ETA，UI 至少能畫
///
/// 文件：https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
class TomTomRoutesService {
  static const _baseUrl = 'https://api.tomtom.com/routing/1/calculateRoute';

  final String apiKey;
  final http.Client _http;

  TomTomRoutesService({String? apiKey, http.Client? client})
      : apiKey = apiKey ?? Env.tomtomApiKey,
        _http = client ?? http.Client();

  bool get hasKey => apiKey.isNotEmpty;

  /// 算從 (fromLat,fromLng) 到 [destination] 的駕車路線。
  /// 失敗（沒 key / API error / 缺座標）→ 直線 fallback。
  /// 完全沒辦法（連 fallback 都不行）→ null。
  Future<RouteSession?> calculateRoute({
    required double fromLat,
    required double fromLng,
    required Stop destination,
  }) async {
    final destLat = destination.lat;
    final destLng = destination.lng;
    if (destLat == null || destLng == null) return null;

    if (hasKey) {
      final real = await _callApi(
        fromLat: fromLat,
        fromLng: fromLng,
        toLat: destLat,
        toLng: destLng,
      );
      if (real != null) return real;
    }

    // ───── fallback：直線 + Haversine 估算 ─────
    return _straightLineFallback(
      fromLat: fromLat,
      fromLng: fromLng,
      toLat: destLat,
      toLng: destLng,
    );
  }

  Future<RouteSession?> _callApi({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
  }) async {
    try {
      final locations = '$fromLat,$fromLng:$toLat,$toLng';
      final uri = Uri.parse(
        '$_baseUrl/$locations/json'
        '?key=$apiKey'
        '&travelMode=car'
        '&routeRepresentation=polyline'
        '&computeTravelTimeFor=all'
        // turn-by-turn 指令（讓 UI 上方 banner 顯示「200m 後右轉」）
        '&instructionsType=text'
        '&language=zh-TW'
        // 車道指引（每路段哪幾條車道往左/直/右）
        '&sectionType=lanes',
      );

      final res = await _http.get(uri).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) {
        debugPrint('[tomtom] HTTP ${res.statusCode}: ${res.body.substring(0, math.min(200, res.body.length))}');
        return null;
      }

      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final routes = (body['routes'] as List?) ?? const [];
      if (routes.isEmpty) {
        debugPrint('[tomtom] no routes returned');
        return null;
      }

      final route = routes.first as Map<String, dynamic>;
      final legs = (route['legs'] as List?) ?? const [];
      if (legs.isEmpty) return null;

      // 把所有 legs 的 points 串起來
      final allPoints = <LatLng>[];
      double totalMeters = 0;
      int totalSeconds = 0;

      for (final leg in legs) {
        final m = leg as Map<String, dynamic>;
        final summary = (m['summary'] as Map?) ?? {};
        totalMeters += (summary['lengthInMeters'] as num?)?.toDouble() ?? 0;
        totalSeconds += (summary['travelTimeInSeconds'] as num?)?.toInt() ?? 0;

        final pts = (m['points'] as List?) ?? const [];
        for (final p in pts) {
          final pm = p as Map<String, dynamic>;
          allPoints.add(LatLng(
            (pm['latitude'] as num).toDouble(),
            (pm['longitude'] as num).toDouble(),
          ));
        }
      }

      // 解析 turn-by-turn instructions（在 route.guidance.instructions[]）
      final instructions = <RouteInstruction>[];
      final guidance = route['guidance'] as Map<String, dynamic>?;
      final rawInstructions = (guidance?['instructions'] as List?) ?? const [];
      for (final raw in rawInstructions) {
        final m = raw as Map<String, dynamic>;
        final pt = m['point'] as Map<String, dynamic>?;
        if (pt == null) continue;
        instructions.add(RouteInstruction(
          routeOffsetMeters:
              (m['routeOffsetInMeters'] as num?)?.toDouble() ?? 0,
          pointIndex: (m['pointIndex'] as num?)?.toInt() ?? 0,
          point: LatLng(
            (pt['latitude'] as num).toDouble(),
            (pt['longitude'] as num).toDouble(),
          ),
          maneuver: _parseManeuver(m['maneuver'] as String?),
          message: (m['message'] as String?) ?? '',
          street: m['street'] as String?,
        ));
      }

      // 解析 lane guidance（在 route.sections[] 裡 sectionType == LANES 的段）
      final laneSections = <RouteLaneSection>[];
      final rawSections = (route['sections'] as List?) ?? const [];
      for (final raw in rawSections) {
        final s = raw as Map<String, dynamic>;
        if (s['sectionType'] != 'LANES') continue;
        final rawLanes = (s['lanes'] as List?) ?? const [];
        final lanes = <RouteLane>[];
        for (final l in rawLanes) {
          final lm = l as Map<String, dynamic>;
          final dirs = ((lm['directions'] as List?) ?? const [])
              .map((d) => _parseLaneDir(d as String?))
              .whereType<LaneDirection>()
              .toList();
          if (dirs.isEmpty) continue;
          lanes.add(RouteLane(
            directions: dirs,
            follow: _parseLaneDir(lm['follow'] as String?),
          ));
        }
        if (lanes.isEmpty) continue;
        laneSections.add(RouteLaneSection(
          startPointIndex: (s['startPointIndex'] as num?)?.toInt() ?? 0,
          endPointIndex: (s['endPointIndex'] as num?)?.toInt() ?? 0,
          lanes: lanes,
        ));
      }

      debugPrint(
        '[tomtom] route OK · ${allPoints.length} pts · '
        '${(totalMeters / 1000).toStringAsFixed(1)}km · ${totalSeconds}s · '
        '${instructions.length} instructions · ${laneSections.length} lane sections',
      );

      return RouteSession(
        points: allPoints,
        instructions: instructions,
        laneSections: laneSections,
        estimatedDuration: Duration(seconds: totalSeconds),
        distanceMeters: totalMeters,
        isReal: true,
      );
    } catch (e, st) {
      debugPrint('[tomtom] exception: $e\n$st');
      return null;
    }
  }

  RouteSession _straightLineFallback({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
  }) {
    final meters = _haversineMeters(fromLat, fromLng, toLat, toLng);
    // 假設市區平均 25 km/h
    final seconds = (meters / 1000.0) / 25.0 * 3600.0;
    return RouteSession(
      points: [
        LatLng(fromLat, fromLng),
        LatLng(toLat, toLng),
      ],
      instructions: const [],
      laneSections: const [],
      estimatedDuration: Duration(seconds: seconds.round()),
      distanceMeters: meters,
      isReal: false,
    );
  }
}

/// 公開的 Haversine 距離（給 NavigationMapView 判斷「是否抵達」用）。
double haversineMeters(double lat1, double lng1, double lat2, double lng2) =>
    _haversineMeters(lat1, lng1, lat2, lng2);

double _haversineMeters(double lat1, double lng1, double lat2, double lng2) {
  const earth = 6371000.0;
  double toRad(double d) => d * math.pi / 180.0;
  final dLat = toRad(lat2 - lat1);
  final dLng = toRad(lng2 - lng1);
  final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(toRad(lat1)) *
          math.cos(toRad(lat2)) *
          math.sin(dLng / 2) *
          math.sin(dLng / 2);
  return 2 * earth * math.asin(math.sqrt(a));
}
