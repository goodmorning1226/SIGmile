/// 對應 delivery_tasks 表。一個 driver 一天一筆。
class DeliveryTask {
  /// task_status enum
  static const statusPending = 'pending';
  static const statusInProgress = 'in_progress';
  static const statusCompleted = 'completed';
  static const statusCancelled = 'cancelled';

  final String id;
  final String deliveryDate; // 'yyyy-MM-dd'
  final String driverId;
  final String? driverRouteAssignmentId;
  final String status;
  final String? currentStopId;
  final DateTime? startedAt;
  final DateTime? completedAt;

  const DeliveryTask({
    required this.id,
    required this.deliveryDate,
    required this.driverId,
    required this.status,
    this.driverRouteAssignmentId,
    this.currentStopId,
    this.startedAt,
    this.completedAt,
  });

  factory DeliveryTask.fromMap(Map<String, dynamic> m) => DeliveryTask(
        id: m['id'] as String,
        deliveryDate: m['delivery_date'] as String,
        driverId: m['driver_id'] as String,
        status: (m['status'] ?? 'pending') as String,
        driverRouteAssignmentId: m['driver_route_assignment_id'] as String?,
        currentStopId: m['current_stop_id'] as String?,
        startedAt: _parseTs(m['started_at']),
        completedAt: _parseTs(m['completed_at']),
      );

  bool get isPending => status == statusPending;
  bool get isInProgress => status == statusInProgress;
  bool get isCompleted => status == statusCompleted;
}

DateTime? _parseTs(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse(v.toString());
}
