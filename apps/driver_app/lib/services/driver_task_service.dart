import '../models/delivery_task.dart';
import '../models/delivery_task_stop.dart';
import 'api_client.dart';

/// 全部走 Next.js backend `/api/driver/*`，由 server 端：
///   - 驗證 Bearer token 與 driver role
///   - 推進 task.current_stop_id
///   - 計算 on_time
///   - 未來呼叫 GoogleNavigationService / AIService
class DriverTodayResponse {
  final DeliveryTask? task;
  final List<DeliveryTaskStop> stops;
  final int completed;
  final int total;
  final DeliveryTaskStop? currentStop;
  final DeliveryTaskStop? nextStop;

  const DriverTodayResponse({
    required this.task,
    required this.stops,
    required this.completed,
    required this.total,
    this.currentStop,
    this.nextStop,
  });

  factory DriverTodayResponse.fromMap(Map<String, dynamic> m) {
    final task = m['task'] == null
        ? null
        : DeliveryTask.fromMap(Map<String, dynamic>.from(m['task'] as Map));
    final stops = ((m['stops'] as List?) ?? [])
        .map((e) =>
            DeliveryTaskStop.fromMap(Map<String, dynamic>.from(e as Map)))
        .toList();
    final progress = Map<String, dynamic>.from(
      (m['progress'] as Map?) ?? const {},
    );
    final current = m['current_stop'] == null
        ? null
        : DeliveryTaskStop.fromMap(
            Map<String, dynamic>.from(m['current_stop'] as Map),
          );
    final next = m['next_stop'] == null
        ? null
        : DeliveryTaskStop.fromMap(
            Map<String, dynamic>.from(m['next_stop'] as Map),
          );
    return DriverTodayResponse(
      task: task,
      stops: stops,
      completed: (progress['completed'] ?? 0) as int,
      total: (progress['total'] ?? stops.length) as int,
      currentStop: current,
      nextStop: next,
    );
  }
}

class DriverTaskService {
  final ApiClient _api;
  DriverTaskService(this._api);

  /// GET /api/driver/today
  Future<DriverTodayResponse> getToday() async {
    final data = await _api.get('/api/driver/today');
    return DriverTodayResponse.fromMap(data);
  }

  /// POST /api/driver/tasks/[taskId]/start
  Future<void> startTask(String taskId) async {
    await _api.post('/api/driver/tasks/$taskId/start');
  }

  /// POST /api/driver/task-stops/[taskStopId]/navigate
  /// 之後串 Google Maps Navigation SDK 時，這個 endpoint 會回 navigation URL / ETA。
  Future<void> markNavigating(String taskStopId) async {
    await _api.post('/api/driver/task-stops/$taskStopId/navigate');
  }

  /// POST /api/driver/task-stops/[taskStopId]/arrive
  Future<void> markArrived(String taskStopId) async {
    await _api.post('/api/driver/task-stops/$taskStopId/arrive');
  }

  /// POST /api/driver/task-stops/[taskStopId]/complete
  /// 後端自動推進到下一站；若全部完成則收尾整個 task。
  Future<void> markCompleted(String taskStopId) async {
    await _api.post('/api/driver/task-stops/$taskStopId/complete');
  }

  /// POST /api/driver/task-stops/[taskStopId]/exception
  Future<void> reportException({
    required String taskStopId,
    required String reason,
    String? note,
  }) async {
    await _api.post(
      '/api/driver/task-stops/$taskStopId/exception',
      body: {'reason': reason, if (note != null && note.isNotEmpty) 'note': note},
    );
  }
}
