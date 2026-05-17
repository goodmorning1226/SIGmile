import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/delivery_task.dart';
import '../models/delivery_task_stop.dart';
import '../services/driver_task_service.dart';
import 'auth_provider.dart';
import 'service_providers.dart';

class TodayBundle {
  final DeliveryTask? task;
  final List<DeliveryTaskStop> stops;
  final int completedCount;
  final int totalCount;
  final DeliveryTaskStop? currentStop;
  final DeliveryTaskStop? nextStop;

  const TodayBundle({
    required this.task,
    required this.stops,
    required this.completedCount,
    required this.totalCount,
    this.currentStop,
    this.nextStop,
  });

  factory TodayBundle.fromResponse(DriverTodayResponse r) => TodayBundle(
        task: r.task,
        stops: r.stops,
        completedCount: r.completed,
        totalCount: r.total,
        currentStop: r.currentStop,
        nextStop: r.nextStop,
      );

  /// 第一個非 terminal 的 stop（不論在 current 之前或之後）。
  /// 用於 task 還沒按「開始配送」、currentStop 為 null 時的 fallback。
  DeliveryTaskStop? get nextPendingStop {
    for (final s in stops) {
      if (!s.isTerminal) return s;
    }
    return null;
  }

  /// 給 UI 用：current stop 之後、且還沒結案的下一個。
  /// 如果 server 已直接回 next_stop 就用它；否則自己挑。
  DeliveryTaskStop? get upcomingStop {
    if (nextStop != null) return nextStop;
    final current = currentStop;
    if (current == null) {
      for (final s in stops) {
        if (!s.isTerminal) return s;
      }
      return null;
    }
    final idx = stops.indexWhere((s) => s.id == current.id);
    for (int i = idx + 1; i < stops.length; i++) {
      if (!stops[i].isTerminal) return stops[i];
    }
    return null;
  }
}

final todayBundleProvider =
    FutureProvider.autoDispose<TodayBundle>((ref) async {
  ref.watch(authStateProvider); // 切換帳號時重抓
  final svc = ref.watch(driverTaskServiceProvider);
  final r = await svc.getToday();
  return TodayBundle.fromResponse(r);
});
