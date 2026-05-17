import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../models/stop.dart';

/// App 內地圖佔位元件。
///
/// 顯示概念性的「現在位置 ──── 目標停靠點」連線示意。
/// 未來把整個 widget 換成 google_maps_flutter 的 GoogleMap 即可，
/// 呼叫端（NavigationMapPage）介面不變。
class MapPlaceholder extends StatelessWidget {
  final Stop stop;
  final String? etaText;

  const MapPlaceholder({
    super.key,
    required this.stop,
    this.etaText,
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Stack(
        children: [
          // 1. 背景：淺灰漸層，模擬地圖底色
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFFEEF2F7),
                    Color(0xFFE2E8F0),
                  ],
                ),
              ),
            ),
          ),

          // 2. 中央往下傾斜的「路線」示意
          Positioned.fill(child: CustomPaint(painter: _RoutePainter())),

          // 3. 目標 pin（中上）
          Align(
            alignment: const Alignment(0, -0.25),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const _PinIcon(),
                const SizedBox(height: 4),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(999),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x1A000000),
                        blurRadius: 4,
                        offset: Offset(0, 1),
                      ),
                    ],
                  ),
                  child: Text(
                    stop.name,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: SigmileColors.textPrimary,
                    ),
                  ),
                ),
                if (etaText != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    etaText!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: SigmileColors.textSecond,
                    ),
                  ),
                ],
              ],
            ),
          ),

          // 4. 物流士當前位置（中下）
          const Align(
            alignment: Alignment(0, 0.85),
            child: _CurrentLocationDot(),
          ),

          // 5. 左上角標示「未串接 Google Maps」
          Positioned(
            top: 10,
            left: 10,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.85),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                '模擬地圖 · 未串接 Google Maps',
                style: TextStyle(
                  fontSize: 11,
                  color: SigmileColors.textSecond,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PinIcon extends StatelessWidget {
  const _PinIcon();
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
            blurRadius: 16,
            spreadRadius: 4,
          ),
        ],
      ),
      child: const Icon(Icons.location_on, color: Colors.white, size: 26),
    );
  }
}

class _CurrentLocationDot extends StatelessWidget {
  const _CurrentLocationDot();
  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            color: const Color(0xFF3B82F6),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [
              BoxShadow(
                color: Color(0x3B3B82F6),
                blurRadius: 10,
                spreadRadius: 3,
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(999),
            boxShadow: const [
              BoxShadow(
                color: Color(0x14000000),
                blurRadius: 3,
                offset: Offset(0, 1),
              ),
            ],
          ),
          child: const Text(
            '我的位置',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1D4ED8),
            ),
          ),
        ),
      ],
    );
  }
}

/// 用虛線從下方的當前位置畫一條到中央的目標 pin
class _RoutePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFFEA580C).withValues(alpha: 0.6)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final start = Offset(size.width / 2, size.height * 0.85);
    final end = Offset(size.width / 2, size.height * 0.40);

    // 虛線
    const dashLen = 8.0;
    const gapLen = 6.0;
    final total = (start - end).distance;
    final dir = (end - start) / total;
    double drawn = 0;
    while (drawn < total) {
      final segEnd = drawn + dashLen;
      final p1 = start + dir * drawn;
      final p2 = start + dir * (segEnd > total ? total : segEnd);
      canvas.drawLine(p1, p2, paint);
      drawn = segEnd + gapLen;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}
