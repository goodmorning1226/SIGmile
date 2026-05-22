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
import '../services/voice_navigation_service.dart';
import 'instruction_banner.dart';

/// App 內地圖 + TomTom 多站路線視圖。
///
/// 設計：
///   - 接收 [stops] 整條路線（1 站或多站皆可，上限 25 站 = TomTom API 限制）
///   - [activeIndex] 標記當前要去的那站；render 時該 pin 高亮 + arrival 判定走這站
///   - 抵達該站時 callback [onStopArrived(index)] 給父層；父層應 markArrived
///     + 把 activeIndex 推進到 index+1（自動切到下一站）
///   - **單站模式**：stops 給 length 1 的 list 即可，effectively 跟舊版一樣
///
/// 多站路線：mount 時只算一次 multi-stop polyline（穿過所有 stops），
/// 之後 activeIndex 變化不重算路線，只切換高亮 + arrival 判定目標。
class TomTomMapView extends StatefulWidget {
  final List<Stop> stops;
  final int activeIndex;
  final TomTomRoutesService routesService;
  final VoiceNavigationService voiceService;
  final void Function(int arrivedIndex)? onStopArrived;

  /// 抵達半徑（公尺）
  final double arrivalThresholdMeters;

  const TomTomMapView({
    super.key,
    required this.stops,
    required this.routesService,
    required this.voiceService,
    this.activeIndex = 0,
    this.onStopArrived,
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

  /// 已經 fire 過 arrival 的 stop index 集合（避免一個 stop 重複觸發）
  final Set<int> _firedArrivals = {};

  /// 下一個要做的 turn-by-turn 指令（GPS update 時即時算）
  RouteInstruction? _nextInstruction;
  double? _metersToNext;

  /// 司機當前速度（公尺/秒）
  double _currentSpeedMps = 0;
  /// 上一次 GPS 的時間 + 座標（給 emulator 自算 speed 用，因為 emu geo fix 不帶速度）
  DateTime? _lastGpsAt;
  LatLng? _lastGpsLatLng;

  /// Navigation 模式：camera 自動 follow driver + 跟 heading 轉
  /// 預設 true；user 手動拖地圖時暫時關掉（之後可加按鈕「重新跟隨」）
  bool _followMode = true;

  Stop get _activeStop => widget.stops[widget.activeIndex];

  @override
  void initState() {
    super.initState();
    if (Env.hasTomTomKey && widget.stops.isNotEmpty && _activeStop.lat != null) {
      _boot();
    }
  }

  @override
  void dispose() {
    _gpsSub?.cancel();
    widget.voiceService.reset();
    super.dispose();
  }

  Future<void> _boot() async {
    setState(() => _state = _BootState.locating);

    try {
      // 1) runtime 索取定位（Web 不走 permission_handler）
      if (!kIsWeb) {
        final perm = await Permission.locationWhenInUse.request();
        if (!perm.isGranted) {
          _fail('定位權限被拒，無法顯示路線');
          return;
        }
      }

      // 2) 取當前位置 — 三段式 fallback，但**過濾掉 emulator 默認 Mountain View**
      //    (37.421998, -122.084000)，否則新北司機被導航到加州 Google HQ
      LatLng? here;
      bool isEmulatorDefault(double lat, double lng) {
        return (lat > 37.42 && lat < 37.43) && (lng > -122.09 && lng < -122.08);
      }
      try {
        final last = await Geolocator.getLastKnownPosition();
        if (last != null && !isEmulatorDefault(last.latitude, last.longitude)) {
          here = LatLng(last.latitude, last.longitude);
          debugPrint('[tomtom-view] using lastKnown: $here');
        } else if (last != null) {
          debugPrint('[tomtom-view] skipping Mountain View default lastKnown');
        }
      } catch (_) {}
      if (here == null) {
        try {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 8),
            ),
          );
          if (!isEmulatorDefault(pos.latitude, pos.longitude)) {
            here = LatLng(pos.latitude, pos.longitude);
            debugPrint('[tomtom-view] using fresh GPS: $here');
          }
        } catch (_) {}
      }
      if (here == null) {
        final lat = _activeStop.lat, lng = _activeStop.lng;
        if (lat != null && lng != null) {
          here = LatLng(lat - 0.005, lng - 0.005);
        } else {
          _fail('無法取得位置且 active stop 無座標');
          return;
        }
      }
      _currentLatLng = here;

      // 3) 算多站路線
      setState(() => _state = _BootState.routing);
      final session = await widget.routesService.calculateMultiStopRoute(
        fromLat: here.latitude,
        fromLng: here.longitude,
        stops: widget.stops,
      );
      if (session == null) {
        _fail('無法規劃路線');
        return;
      }
      _route = session;

      // 4) voice 初始化（async，不擋 UI）
      unawaited(widget.voiceService.initialize());

      // 5) 訂閱 GPS（5m 推一次）
      _gpsSub?.cancel();
      _gpsSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 5,
        ),
      ).listen(_onGpsUpdate);

      // 6) Navigation mode：camera 直接 follow driver（在 17 zoom level）。
      //    舊版會 fit 整條路線然後 zoom out 到看到目的地，但那不是 navigation
      //    體驗。現在開場就 zoom 到 driver 位置 + heading 跟著走。
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_currentLatLng != null) {
          _map.move(_currentLatLng!, 17);
        }
      });
      unawaited(widget.voiceService.announce(
        widget.stops.length == 1
            ? '開始導航前往${_activeStop.name}'
            : '開始整日配送，共 ${widget.stops.length} 站，第一站 ${_activeStop.name}',
      ));

      if (mounted) setState(() => _state = _BootState.ready);
    } catch (e, st) {
      debugPrint('[tomtom-view] boot exception: $e\n$st');
      _fail('啟動例外：$e');
    }
  }

  @override
  void didUpdateWidget(covariant TomTomMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    // active stop 切換時清語音歷史，避免新 leg 不念
    if (oldWidget.activeIndex != widget.activeIndex) {
      widget.voiceService.resetSpokenHistory();
    }
  }

  void _onGpsUpdate(Position p) {
    if (!mounted) return;
    final newPos = LatLng(p.latitude, p.longitude);

    // 速度：優先用 OS 報的 Position.speed（真機 GPS 內建有）；
    // emulator 通常給 0/NaN，所以 fallback 自己用 delta-distance / delta-time 算
    final now = DateTime.now();
    double speed = (p.speed.isNaN || p.speed < 0) ? 0 : p.speed;
    if (speed == 0 && _lastGpsAt != null && _lastGpsLatLng != null) {
      final dt = now.difference(_lastGpsAt!).inMilliseconds / 1000.0;
      if (dt > 0.05) {
        final dist = haversineMeters(
          _lastGpsLatLng!.latitude, _lastGpsLatLng!.longitude,
          p.latitude, p.longitude,
        );
        speed = dist / dt;
        // 太誇張的瞬時值 cap 在 200 km/h
        if (speed > 55) speed = 55;
      }
    }
    _currentSpeedMps = speed;
    _lastGpsAt = now;
    _lastGpsLatLng = newPos;
    debugPrint(
      '[tomtom-view] GPS update lat=${p.latitude.toStringAsFixed(5)} '
      'lng=${p.longitude.toStringAsFixed(5)} '
      'osSpeed=${p.speed.toStringAsFixed(2)} '
      'calcSpeed=${(speed * 3.6).toStringAsFixed(1)}km/h',
    );

    // 找下一個 instruction（離我最近且還沒過 >25m）
    RouteInstruction? next;
    double? metersToNext;
    final ins = _route?.instructions;
    if (ins != null && ins.isNotEmpty) {
      double bestDist = double.infinity;
      for (final inst in ins) {
        if (inst.maneuver == RouteManeuver.depart) continue;
        final d = haversineMeters(
          p.latitude, p.longitude,
          inst.point.latitude, inst.point.longitude,
        );
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

    // 觸發語音（service 自己防重複）
    if (next != null && metersToNext != null) {
      unawaited(widget.voiceService.maybeSpeak(next, metersToNext));
    }

    // 抵達當前 active stop 判定
    final destLat = _activeStop.lat;
    final destLng = _activeStop.lng;
    if (destLat == null || destLng == null) return;
    if (_firedArrivals.contains(widget.activeIndex)) return;

    final dist = haversineMeters(p.latitude, p.longitude, destLat, destLng);
    if (dist <= widget.arrivalThresholdMeters) {
      _firedArrivals.add(widget.activeIndex);
      unawaited(widget.voiceService.announce(
        '已抵達 ${_activeStop.name}',
      ));
      widget.onStopArrived?.call(widget.activeIndex);
    }
  }

  void _fitRoute() {
    final pts = _route?.points;
    if (pts == null || pts.isEmpty) return;
    final bounds = LatLngBounds.fromPoints(
      [...pts, if (_currentLatLng != null) _currentLatLng!],
    );
    _map.fitCamera(
      CameraFit.bounds(bounds: bounds, padding: const EdgeInsets.all(40)),
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
    if (widget.stops.isEmpty || _activeStop.lat == null || _activeStop.lng == null) {
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
          if (_nextInstruction != null)
            Positioned(
              top: 10,
              left: 10,
              right: 10,
              child: InstructionBanner(
                instruction: _nextInstruction,
                lanes: _route?.lanesFor(_nextInstruction!),
                metersToNext: _metersToNext,
              ),
            ),
          // 速度顯示（左下角，Google 風格）
          Positioned(
            bottom: 16,
            left: 12,
            child: _SpeedChip(speedMps: _currentSpeedMps),
          ),
          // 多站進度 chip（右下）
          if (widget.stops.length > 1)
            Positioned(
              bottom: 16,
              right: 12,
              child: _multiStopProgressChip(),
            ),
          // 路線距離/ETA chip（頂部小卡，instruction banner 還沒 ready 時顯示）
          if (_route != null && _nextInstruction == null) _routeInfoChip(),
          // user 拖過地圖後出現「跟隨我」按鈕
          if (!_followMode && _state == _BootState.ready)
            Positioned(
              bottom: 80,
              right: 12,
              child: FloatingActionButton.small(
                heroTag: 'follow-me',
                backgroundColor: Colors.white,
                foregroundColor: SigmileColors.brand,
                onPressed: () {
                  setState(() => _followMode = true);
                  // 立刻 jump 到當前位置
                  if (_currentLatLng != null) {
                    _map.move(_currentLatLng!, 17);
                  }
                },
                child: const Icon(Icons.my_location),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMap() {
    return FlutterMap(
      mapController: _map,
      options: MapOptions(
        initialCenter: _currentLatLng ??
            LatLng(_activeStop.lat!, _activeStop.lng!),
        // Navigation 級 zoom（street level）— 看得到路名 + 車道
        initialZoom: 17,
        // minZoom 放到 1 讓 driver 可以一直 zoom out（到整個世界級）
        minZoom: 1,
        maxZoom: 19,
        // user 拖地圖時暫停 follow（避免 camera 跟手指搶）
        onPositionChanged: (camera, hasGesture) {
          if (hasGesture && _followMode) {
            setState(() => _followMode = false);
          }
        },
      ),
      children: [
        TileLayer(
          urlTemplate:
              'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png'
              '?key=${Env.tomtomApiKey}',
          userAgentPackageName: 'com.sigmile.sigmile_driver',
          maxZoom: 22,
          tileProvider: NetworkTileProvider(),
        ),
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
        // 所有站的編號 pin（active 高亮、已完成淡灰、未到的橘色）
        MarkerLayer(markers: _buildStopMarkers()),
        // 司機 GPS 藍點 — Navigation mode：camera 跟著走 + 朝行進方向旋轉
        CurrentLocationLayer(
          alignPositionOnUpdate: _followMode
              ? AlignOnUpdate.always
              : AlignOnUpdate.never,
          alignDirectionOnUpdate: _followMode
              ? AlignOnUpdate.always
              : AlignOnUpdate.never,
          // 把藍點偏移到畫面下方 1/3（給前方路線更多空間，跟 Google 一樣）
          alignPositionAnimationDuration: const Duration(milliseconds: 400),
          alignDirectionAnimationDuration: const Duration(milliseconds: 200),
        ),
        const RichAttributionWidget(
          attributions: [TextSourceAttribution('© TomTom', prependCopyright: false)],
        ),
      ],
    );
  }

  List<Marker> _buildStopMarkers() {
    final markers = <Marker>[];
    for (var i = 0; i < widget.stops.length; i++) {
      final s = widget.stops[i];
      if (s.lat == null || s.lng == null) continue;
      final isActive = i == widget.activeIndex;
      final isDone = _firedArrivals.contains(i);
      markers.add(Marker(
        point: LatLng(s.lat!, s.lng!),
        width: isActive ? 48 : 36,
        height: isActive ? 48 : 36,
        child: _StopPin(
          number: i + 1,
          isActive: isActive,
          isDone: isDone,
        ),
      ));
    }
    return markers;
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
            BoxShadow(color: Color(0x1A000000), blurRadius: 6, offset: Offset(0, 2)),
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

  Widget _multiStopProgressChip() {
    final completed = _firedArrivals.length;
    final total = widget.stops.length;
    return Positioned(
      top: 60,
      right: 10,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: SigmileColors.accent,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          '$completed / $total',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

enum _BootState { idle, locating, routing, ready, error }

// ===========================================================================
/// Google Maps 風格的速度顯示（左下角圓形 chip：大字速度 + 小字 km/h）
class _SpeedChip extends StatelessWidget {
  final double speedMps;
  const _SpeedChip({required this.speedMps});

  @override
  Widget build(BuildContext context) {
    final kmh = (speedMps * 3.6).round();
    return Container(
      width: 64,
      height: 64,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '$kmh',
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: SigmileColors.textPrimary,
              height: 1,
            ),
          ),
          const Text(
            'km/h',
            style: TextStyle(
              fontSize: 10,
              color: SigmileColors.textSecond,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}

class _StopPin extends StatelessWidget {
  final int number;
  final bool isActive;
  final bool isDone;
  const _StopPin({
    required this.number,
    required this.isActive,
    required this.isDone,
  });

  @override
  Widget build(BuildContext context) {
    final color = isDone
        ? SigmileColors.accent
        : (isActive ? SigmileColors.brand : SigmileColors.brandDark);
    return Container(
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(
          color: Colors.white,
          width: isActive ? 3 : 2,
        ),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.35),
            blurRadius: isActive ? 16 : 6,
            spreadRadius: isActive ? 3 : 1,
          ),
        ],
      ),
      alignment: Alignment.center,
      child: isDone
          ? const Icon(Icons.check, color: Colors.white, size: 18)
          : Text(
              '$number',
              style: TextStyle(
                color: Colors.white,
                fontSize: isActive ? 18 : 14,
                fontWeight: FontWeight.w800,
              ),
            ),
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
        '  1. https://developer.tomtom.com/ 註冊\n'
        '  2. Dashboard → My Credentials → Add API key\n'
        '  3. .vscode/launch.json 加：\n'
        '     --dart-define=TOMTOM_API_KEY=xxxxxxxx\n'
        '  4. F5 重啟（hot reload 不會吃 dart-define）',
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
              style: const TextStyle(fontSize: 12, color: SigmileColors.textSecond),
            ),
          ],
        ),
      ),
    );
  }
}
