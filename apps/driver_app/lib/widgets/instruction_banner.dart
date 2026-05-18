import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../services/tomtom_routes_service.dart';

/// Google Maps-style 顯示「下一個轉彎」的頂部 banner。
///
/// 三層資訊（由上到下）：
///   1. 大箭頭（依 maneuver 切換）+ 距離文字（「200 公尺」）
///   2. 指令訊息（「右轉進入松高路」）
///   3. 車道帶（如有 lane guidance）：用小箭頭顯示每條車道允許方向，
///      推薦車道（follow 欄位）會高亮成 brand orange，不推薦灰色
///
/// 沒 instruction 時 widget 自動隱藏（回傳 SizedBox.shrink）。
class InstructionBanner extends StatelessWidget {
  final RouteInstruction? instruction;
  final RouteLaneSection? lanes;
  /// 距離下一個轉彎還剩多少公尺（GPS 即時算）。null = 隱藏距離
  final double? metersToNext;

  const InstructionBanner({
    super.key,
    required this.instruction,
    this.lanes,
    this.metersToNext,
  });

  @override
  Widget build(BuildContext context) {
    final ins = instruction;
    if (ins == null) return const SizedBox.shrink();

    final distText = metersToNext == null
        ? null
        : metersToNext! < 1000
            ? '${metersToNext!.toStringAsFixed(0)} 公尺'
            : '${(metersToNext! / 1000).toStringAsFixed(1)} 公里';

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: SigmileColors.brandDark,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // 上層：大箭頭 + 距離 + message
          Row(
            children: [
              _ManeuverArrow(maneuver: ins.maneuver, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (distText != null)
                      Text(
                        distText,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          height: 1.1,
                        ),
                      ),
                    const SizedBox(height: 2),
                    Text(
                      ins.message.isEmpty ? _maneuverFallbackText(ins.maneuver) : ins.message,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          // 下層：lane indicators（如有）
          if (lanes != null && lanes!.lanes.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (final lane in lanes!.lanes) ...[
                    _LaneArrow(lane: lane),
                    const SizedBox(width: 4),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _maneuverFallbackText(RouteManeuver m) {
    switch (m) {
      case RouteManeuver.turnLeft:        return '左轉';
      case RouteManeuver.turnRight:       return '右轉';
      case RouteManeuver.sharpLeft:       return '急左轉';
      case RouteManeuver.sharpRight:      return '急右轉';
      case RouteManeuver.bearLeft:        return '靠左';
      case RouteManeuver.bearRight:       return '靠右';
      case RouteManeuver.keepLeft:        return '保持左側';
      case RouteManeuver.keepRight:       return '保持右側';
      case RouteManeuver.straight:        return '直行';
      case RouteManeuver.depart:          return '出發';
      case RouteManeuver.arrive:
      case RouteManeuver.arriveLeft:
      case RouteManeuver.arriveRight:     return '即將抵達';
      case RouteManeuver.makeUTurn:
      case RouteManeuver.tryMakeUTurn:    return '迴轉';
      case RouteManeuver.roundaboutLeft:
      case RouteManeuver.roundaboutRight:
      case RouteManeuver.roundaboutCross:
      case RouteManeuver.roundaboutBack:  return '進入圓環';
      case RouteManeuver.takeExit:
      case RouteManeuver.motorwayExitLeft:
      case RouteManeuver.motorwayExitRight: return '下交流道';
      case RouteManeuver.enterMotorway:
      case RouteManeuver.enterFreeway:
      case RouteManeuver.enterHighway:    return '上高速公路';
      default: return '繼續前進';
    }
  }
}

// ===========================================================================
// 主箭頭：依 maneuver 變圖示 + 旋轉角度
// ===========================================================================
class _ManeuverArrow extends StatelessWidget {
  final RouteManeuver maneuver;
  final double size;
  const _ManeuverArrow({required this.maneuver, this.size = 44});

  @override
  Widget build(BuildContext context) {
    final (icon, rotateDeg) = _iconFor(maneuver);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Transform.rotate(
        angle: rotateDeg * 3.141592653589793 / 180.0,
        child: Icon(icon, color: Colors.white, size: size * 0.75),
      ),
    );
  }

  // 回 (圖示, 旋轉角度) — 旋轉是因為 turn_right/left 不夠細，sharp/bear 用旋轉差異化
  (IconData, double) _iconFor(RouteManeuver m) {
    switch (m) {
      case RouteManeuver.turnLeft:        return (Icons.turn_left, 0);
      case RouteManeuver.turnRight:       return (Icons.turn_right, 0);
      case RouteManeuver.sharpLeft:       return (Icons.turn_sharp_left, 0);
      case RouteManeuver.sharpRight:      return (Icons.turn_sharp_right, 0);
      case RouteManeuver.bearLeft:        return (Icons.turn_slight_left, 0);
      case RouteManeuver.bearRight:       return (Icons.turn_slight_right, 0);
      case RouteManeuver.keepLeft:        return (Icons.fork_left, 0);
      case RouteManeuver.keepRight:       return (Icons.fork_right, 0);
      case RouteManeuver.straight:        return (Icons.straight, 0);
      case RouteManeuver.depart:          return (Icons.navigation, 0);
      case RouteManeuver.arrive:
      case RouteManeuver.arriveLeft:
      case RouteManeuver.arriveRight:     return (Icons.flag_circle, 0);
      case RouteManeuver.makeUTurn:
      case RouteManeuver.tryMakeUTurn:    return (Icons.u_turn_left, 0);
      case RouteManeuver.roundaboutLeft:
      case RouteManeuver.roundaboutCross:
      case RouteManeuver.roundaboutBack:
      case RouteManeuver.roundaboutRight: return (Icons.roundabout_left, 0);
      case RouteManeuver.takeExit:
      case RouteManeuver.motorwayExitLeft:
      case RouteManeuver.motorwayExitRight: return (Icons.merge, 180);
      case RouteManeuver.enterMotorway:
      case RouteManeuver.enterFreeway:
      case RouteManeuver.enterHighway:    return (Icons.merge_type, 0);
      default: return (Icons.arrow_upward, 0);
    }
  }
}

// ===========================================================================
// 車道小箭頭：依 directions 顯示，follow 推薦的高亮
// ===========================================================================
class _LaneArrow extends StatelessWidget {
  final RouteLane lane;
  const _LaneArrow({required this.lane});

  @override
  Widget build(BuildContext context) {
    final follow = lane.follow;
    final recommended = lane.isRecommended;

    // 用 follow 方向當主要圖示；如果沒 follow 用第一個 direction
    final mainDir = follow ?? lane.directions.first;
    final icon = _laneIcon(mainDir);

    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: recommended
            ? SigmileColors.brand
            : Colors.white.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Icon(
        icon,
        color: recommended ? Colors.white : Colors.white.withValues(alpha: 0.6),
        size: 20,
      ),
    );
  }

  IconData _laneIcon(LaneDirection d) {
    switch (d) {
      case LaneDirection.straight:     return Icons.straight;
      case LaneDirection.slightRight:  return Icons.turn_slight_right;
      case LaneDirection.right:        return Icons.turn_right;
      case LaneDirection.sharpRight:   return Icons.turn_sharp_right;
      case LaneDirection.rightUTurn:   return Icons.u_turn_right;
      case LaneDirection.slightLeft:   return Icons.turn_slight_left;
      case LaneDirection.left:         return Icons.turn_left;
      case LaneDirection.sharpLeft:    return Icons.turn_sharp_left;
      case LaneDirection.leftUTurn:    return Icons.u_turn_left;
    }
  }
}
