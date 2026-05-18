import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_location_marker/flutter_map_location_marker.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:permission_handler/permission_handler.dart';

import '../app/theme.dart';
import '../config/env.dart';
import '../models/stop.dart';
import '../services/tomtom_routes_service.dart';
import 'instruction_banner.dart';

/// App 內地圖 + TomTom 路線視圖。
///
/// 行為：
///   1. mount 時：runtime 索取定位權限 → 取一次當前位置 → 呼叫 TomTomRoutesService
///   2. 拿到 route 後：在 flutter_map 上畫 polyline、放目的地 pin、開 GPS 藍點
///   3. 訂閱 GPS stream：每次位置更新就 [_checkArrival]，<50m 視為抵達 → [onArrived]
///   4. unmount 時：取消 GPS subscription
///
/// 平台守衛：
///   - 沒 TomTom API key → 顯示 [_NoKeyHint]
///   - stop 缺 lat/lng → 顯示 [_NoCoordHint]
///   - 定位權限被拒 → 顯示 fallback + 沒法跟車（但仍能畫直線預估）
class TomTomMapView extends StatefulWidget {
  final Stop stop;
  final TomTomRoutesService routesService;
  final VoidCallback? onArrived;

  /// 抵達半徑（公尺）。GPS 距離目的地 ≤ 這個值就觸發 onArrived。
  final double arrivalThresholdMeters;

  const TomTomMapView({
    super.key,
    required this.stop,
    required this.routesService,
    this.onArrived,
    this.arrivalThresholdMeters = 50,
  });

  @override
  State<TomTomMapView> createState() => _TomTomMapViewState();
}

class _TomTomMapViewState extends State<TomTomMapView> {
  final MapController _map = MapController();
  StreamSubscription<Position>? _gpsSub;

  _BootState _state = _BootState.idle;
  String? _errorMessage;
  RouteSession? _route;
  LatLng? _currentLatLng;
  bool _arrivalFired = false;

  /// 下一個要做的 turn-by-turn 指令（GPS update 時即時算）
  RouteInstruction? _nextInstruction;
  double? _metersToNext;

  @override
  void initState() {
    super.initState();
    if (Env.hasTomTomKey && widget.stop.lat != null) {
      _boot();
    }
  }

  @override
  void dispose() {
    _gpsSub?.cancel();
    super.dispose();
  }

  Future<void> _boot() async {
    setState(() => _state = _BootState.locating);

    try {
      // 1) runtime 索取定位（Web 不走 permission_handler，瀏覽器原生 geolocation
      //    會自己跳權限對話框）
      if (!kIsWeb) {
        final perm = await Permission.locationWhenInUse.request();
        if (!perm.isGranted) {
          _fail('定位權限被拒，無法顯示路線');
          return;
        }
      }

      // 2) 取當前位置 — 三段式 fallback，避免 emulator 卡死
      LatLng? here;

      // 2a) 先 getLastKnownPosition：返回上次 cache，**立即返回**不等 fix
      try {
        final last = await Geolocator.getLastKnownPosition();
        if (last != null) {
          here = LatLng(last.latitude, last.longitude);
          debugPrint('[tomtom-view] using cached last-known: $here');
        }
      } catch (e) {
        debugPrint('[tomtom-view] getLastKnownPosition failed: $e');
      }

      // 2b) 再嘗試 getCurrentPosition，但**限 8 秒**，避免 emulator 沒新 fix 時卡死
      if (here == null) {
        try {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 8),
            ),
          );
          here = LatLng(pos.latitude, pos.longitude);
          debugPrint('[tomtom-view] got fresh GPS: $here');
        } catch (e) {
          debugPrint('[tomtom-view] getCurrentPosition timed out / failed: $e');
        }
      }

      // 2c) 最後 fallback：用目的地附近的座標當作起點（讓地圖至少能顯示，UI 上會
      //     提示直線估算）。實際 driver 開車後第一個 GPS fix 來時 _onGpsUpdate
      //     會接管，路線也會在 ~30 秒內自動更新。
      if (here == null) {
        final destLat = widget.stop.lat;
        final destLng = widget.stop.lng;
        if (destLat != null && destLng != null) {
          here = LatLng(destLat - 0.005, destLng - 0.005);
          debugPrint('[tomtom-view] GPS unavailable, fallback to near destination');
        } else {
          _fail('無法取得目前位置（GPS 服務未就緒，或 emulator 沒推 geo fix）');
          return;
        }
      }

      _currentLatLng = here;

      // 3) 呼叫 TomTom Routing
      setState(() => _state = _BootState.routing);
      final session = await widget.routesService.calculateRoute(
        fromLat: here.latitude,
        fromLng: here.longitude,
        destination: widget.stop,
      );
      if (session == null) {
        _fail('無法規劃路線');
        return;
      }
      _route = session;

      // 4) 訂閱 GPS 更新（5m 推一次）
      _gpsSub?.cancel();
      _gpsSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 5,
        ),
      ).listen(_onGpsUpdate);

      // 5) 鏡頭 fit 路線
      WidgetsBinding.instance.addPostFrameCallback((_) => _fitRoute());

      if (mounted) setState(() => _state = _BootState.ready);
    } catch (e, st) {
      debugPrint('[tomtom-view] boot exception: $e\n$st');
      _fail('啟動例外：$e');
    }
  }

  void _onGpsUpdate(Position p) {
    if (!mounted) return;

    // 1) 更新蓝点位置
    final newPos = LatLng(p.latitude, p.longitude);

    // 2) 找下一個 turn-by-turn 指令：取所有 instructions 中離我最近、且還沒過的
    RouteInstruction? next;
    double? metersToNext;
    final ins = _route?.instructions;
    if (ins != null && ins.isNotEmpty) {
      double bestDist = double.infinity;
      for (final inst in ins) {
        // 跳過 DEPART（已從那裡出發了）+ ARRIVE（最後再說）
        if (inst.maneuver == RouteManeuver.depart) continue;
        final d = haversineMeters(
          p.latitude, p.longitude,
          inst.point.latitude, inst.point.longitude,
        );
        // 已經開過的（< 25m 視為通過）跳掉
        if (d < 25) continue;
        if (d < bestDist) {
          bestDist = d;
          next = inst;
          metersToNext = d;
        }
      }
    }

    setState(() {
      _currentLatLng = newPos;
      _nextInstruction = next;
      _metersToNext = metersToNext;
    });

    // 3) 抵達判定
    final destLat = widget.stop.lat;
    final destLng = widget.stop.lng;
    if (destLat == null || destLng == null || _arrivalFired) return;

    final dist = haversineMeters(p.latitude, p.longitude, destLat, destLng);
    if (dist <= widget.arrivalThresholdMeters) {
      _arrivalFired = true;
      widget.onArrived?.call();
    }
  }

  void _fitRoute() {
    final pts = _route?.points;
    if (pts == null || pts.isEmpty) return;
    final bounds = LatLngBounds.fromPoints(
      [...pts, if (_currentLatLng != null) _currentLatLng!],
    );
    _map.fitCamera(
      CameraFit.bounds(
        bounds: bounds,
        padding: const EdgeInsets.all(40),
      ),
    );
  }

  void _fail(String msg) {
    if (!mounted) return;
    setState(() {
      _state = _BootState.error;
      _errorMessage = msg;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!Env.hasTomTomKey) return const _NoKeyHint();
    if (widget.stop.lat == null || widget.stop.lng == null) {
      return const _NoCoordHint();
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Stack(
        children: [
          _buildMap(),
          if (_state == _BootState.locating || _state == _BootState.routing)
            _OverlayLoading(
              text: _state == _BootState.locating ? '取得位置中…' : '規劃路線中…',
            ),
          if (_state == _BootState.error)
            _OverlayError(message: _errorMessage ?? '未知錯誤'),
          if (_route != null) _routeInfoChip(),
          // 上方：Google Maps 風格的下一步指令 banner（大箭頭 + 距離 + 車道）
          if (_nextInstruction != null)
            Positioned(
              top: 60,
              left: 10,
              right: 10,
              child: InstructionBanner(
                instruction: _nextInstruction,
                lanes: _route?.lanesFor(_nextInstruction!),
                metersToNext: _metersToNext,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMap() {
    final destLat = widget.stop.lat!;
    final destLng = widget.stop.lng!;
    final dest = LatLng(destLat, destLng);

    return FlutterMap(
      mapController: _map,
      options: MapOptions(
        initialCenter: _currentLatLng ?? dest,
        initialZoom: 13,
        minZoom: 3,
        maxZoom: 19,
      ),
      children: [
        // TomTom raster tile layer
        TileLayer(
          urlTemplate:
              'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png'
              '?key=${Env.tomtomApiKey}',
          userAgentPackageName: 'com.sigmile.sigmile_driver',
          maxZoom: 22,
          tileProvider: NetworkTileProvider(),
          // TomTom 要求 attribution
          tileBuilder: (ctx, child, tile) => child,
        ),
        // 路線 polyline
        if (_route != null && _route!.points.length >= 2)
          PolylineLayer(
            polylines: [
              Polyline(
                points: _route!.points,
                strokeWidth: 5,
                color: _route!.isReal
                    ? SigmileColors.brand
                    : SigmileColors.brand.withValues(alpha: 0.5),
                pattern: _route!.isReal
                    ? const StrokePattern.solid()
                    : StrokePattern.dashed(segments: const [10, 8]),
              ),
            ],
          ),
        // 目的地 pin
        MarkerLayer(
          markers: [
            Marker(
              point: dest,
              width: 44,
              height: 44,
              child: const _DestinationPin(),
            ),
          ],
        ),
        // 司機 GPS 藍點（藉 flutter_map_location_marker 直接訂閱 geolocator）
        CurrentLocationLayer(
          alignPositionOnUpdate: AlignOnUpdate.never,
          alignDirectionOnUpdate: AlignOnUpdate.never,
        ),
        // TomTom attribution（required by ToS）
        const RichAttributionWidget(
          attributions: [
            TextSourceAttribution(
              '© TomTom',
              prependCopyright: false,
            ),
          ],
        ),
      ],
    );
  }

  Widget _routeInfoChip() {
    final r = _route!;
    return Positioned(
      top: 10,
      left: 10,
      right: 10,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.95),
          borderRadius: BorderRadius.circular(10),
          boxShadow: const [
            BoxShadow(
              color: Color(0x1A000000),
              blurRadius: 6,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Icon(
              r.isReal ? Icons.route : Icons.alt_route,
              size: 16,
              color: SigmileColors.brandDark,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                r.isReal
                    ? '${r.formattedDistance} · ${r.formattedEta}'
                    : '直線估算 ${r.formattedDistance} · ${r.formattedEta}',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: SigmileColors.textPrimary,
                ),
              ),
            ),
            IconButton(
              onPressed: _fitRoute,
              icon: const Icon(Icons.center_focus_strong, size: 18),
              tooltip: '重新對齊路線',
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
            ),
          ],
        ),
      ),
    );
  }
}

enum _BootState { idle, locating, routing, ready, error }

// ===========================================================================
class _DestinationPin extends StatelessWidget {
  const _DestinationPin();
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      decoration: const BoxDecoration(
        color: SigmileColors.brand,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Color(0x33EA580C),
            blurRadius: 12,
            spreadRadius: 3,
          ),
        ],
      ),
      child: const Icon(Icons.location_on, color: Colors.white, size: 24),
    );
  }
}

class _NoKeyHint extends StatelessWidget {
  const _NoKeyHint();
  @override
  Widget build(BuildContext context) {
    return const _InfoPanel(
      icon: Icons.key_off,
      title: '尚未設定 TomTom API Key',
      body: Text(
        '設定步驟：\n'
        '  1. 到 https://developer.tomtom.com/ 註冊（免信用卡）\n'
        '  2. Dashboard → My Credentials → 新增 API key\n'
        '  3. 把 key 加到 .vscode/launch.json：\n'
        '     --dart-define=TOMTOM_API_KEY=xxxxxxxxxxxxxxxx\n'
        '  4. F5 重啟 App（hot reload 不會吃 dart-define）',
        style: TextStyle(
          fontSize: 12,
          fontFamily: 'monospace',
          color: SigmileColors.textSecond,
        ),
      ),
    );
  }
}

class _NoCoordHint extends StatelessWidget {
  const _NoCoordHint();
  @override
  Widget build(BuildContext context) {
    return const _InfoPanel(
      icon: Icons.location_disabled,
      title: '此停靠點未設定座標',
      body: Text(
        '需要 lat/lng 才能規劃路線。請聯絡管理員補上座標。',
        style: TextStyle(fontSize: 13, color: SigmileColors.textSecond),
      ),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget body;
  const _InfoPanel({
    required this.icon,
    required this.title,
    required this.body,
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFCD34D)),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, color: SigmileColors.brandDark, size: 22),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: SigmileColors.brandDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          body,
        ],
      ),
    );
  }
}

class _OverlayLoading extends StatelessWidget {
  final String text;
  const _OverlayLoading({required this.text});
  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black.withValues(alpha: 0.25),
      alignment: Alignment.center,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 10),
            Text(text, style: const TextStyle(fontSize: 13)),
          ],
        ),
      ),
    );
  }
}

class _OverlayError extends StatelessWidget {
  final String message;
  const _OverlayError({required this.message});
  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black.withValues(alpha: 0.55),
      alignment: Alignment.center,
      padding: const EdgeInsets.all(20),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.error_outline, color: SigmileColors.danger),
                SizedBox(width: 8),
                Text(
                  '導航失敗',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: SigmileColors.danger,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: const TextStyle(
                fontSize: 12,
                color: SigmileColors.textSecond,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// 給其他 widget import 用
const bool isWebPlatform = kIsWeb;
