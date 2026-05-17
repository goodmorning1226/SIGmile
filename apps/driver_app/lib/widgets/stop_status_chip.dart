import 'package:flutter/material.dart';

import '../models/delivery_task_stop.dart';

class StopStatusChip extends StatelessWidget {
  final String status;
  const StopStatusChip({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, bg, fg) = _styleFor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  (String, Color, Color) _styleFor(String status) {
    switch (status) {
      case DeliveryTaskStop.statusPending:
        return ('待處理', const Color(0xFFE2E8F0), const Color(0xFF334155));
      case DeliveryTaskStop.statusNavigating:
        return ('導航中', const Color(0xFFFFEDD5), const Color(0xFFC2410C));
      case DeliveryTaskStop.statusArrived:
        return ('已抵達', const Color(0xFFFFEDD5), const Color(0xFFC2410C));
      case DeliveryTaskStop.statusCompleted:
        return ('已完成', const Color(0xFFD1FAE5), const Color(0xFF047857));
      case DeliveryTaskStop.statusFailed:
        return ('異常', const Color(0xFFFEE2E2), const Color(0xFFB91C1C));
      case DeliveryTaskStop.statusSkipped:
        return ('略過', const Color(0xFFFEF3C7), const Color(0xFFB45309));
      default:
        return (status, const Color(0xFFE2E8F0), const Color(0xFF334155));
    }
  }
}
