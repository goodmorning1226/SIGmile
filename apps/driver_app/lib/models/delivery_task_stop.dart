import 'stop.dart';

/// 對應 delivery_task_stops 表（含 join 進來的 stop）。
class DeliveryTaskStop {
  /// task_stop_status enum
  static const statusPending = 'pending';
  static const statusNavigating = 'navigating';
  static const statusArrived = 'arrived';
  static const statusCompleted = 'completed';
  static const statusFailed = 'failed';
  static const statusSkipped = 'skipped';

  final String id;
  final String deliveryTaskId;
  final String? routeStopId;
  final String stopId;
  final int stopOrder;
  final String status;
  final DateTime? plannedArrivalAt;
  final DateTime? actualArrivalAt;
  final DateTime? completedAt;
  final bool? onTime;
  final String? exceptionReason;
  final String? exceptionNote;
  final Stop? stop;

  const DeliveryTaskStop({
    required this.id,
    required this.deliveryTaskId,
    required this.stopId,
    required this.stopOrder,
    required this.status,
    this.routeStopId,
    this.plannedArrivalAt,
    this.actualArrivalAt,
    this.completedAt,
    this.onTime,
    this.exceptionReason,
    this.exceptionNote,
    this.stop,
  });

  factory DeliveryTaskStop.fromMap(Map<String, dynamic> m) {
    final stopRaw = m['stop'];
    return DeliveryTaskStop(
      id: m['id'] as String,
      deliveryTaskId: m['delivery_task_id'] as String,
      routeStopId: m['route_stop_id'] as String?,
      stopId: m['stop_id'] as String,
      stopOrder: (m['stop_order'] ?? 0) as int,
      status: (m['status'] ?? 'pending') as String,
      plannedArrivalAt: _parseTs(m['planned_arrival_at']),
      actualArrivalAt: _parseTs(m['actual_arrival_at']),
      completedAt: _parseTs(m['completed_at']),
      onTime: m['on_time'] as bool?,
      exceptionReason: m['exception_reason'] as String?,
      exceptionNote: m['exception_note'] as String?,
      stop: stopRaw is Map<String, dynamic> ? Stop.fromMap(stopRaw) : null,
    );
  }

  bool get isTerminal =>
      status == statusCompleted ||
      status == statusFailed ||
      status == statusSkipped;
}

DateTime? _parseTs(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse(v.toString());
}
