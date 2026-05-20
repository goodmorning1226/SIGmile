import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../app/theme.dart';
import '../models/delivery_task_stop.dart';
import '../providers/today_task_provider.dart';
import '../widgets/error_view.dart';
import '../widgets/loading_view.dart';
import '../widgets/stop_status_chip.dart';

class StopListPage extends ConsumerWidget {
  const StopListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bundleAsync = ref.watch(todayBundleProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('停靠點清單')),
      body: bundleAsync.when(
        loading: () => const LoadingView(message: '載入停靠點…'),
        error: (e, _) => ErrorView(
          message: '載入失敗：$e',
          onRetry: () => ref.invalidate(todayBundleProvider),
        ),
        data: (bundle) {
          if (bundle.stops.isEmpty) {
            return const Center(
              child: Text(
                '今日尚無派送任務',
                style: TextStyle(color: SigmileColors.textMute),
              ),
            );
          }
          final stops = bundle.stops;
          final hasMultipleTrips = stops.any((s) => s.tripIndex >= 2);

          // 把 header + trip 分隔線 + stops 平鋪成 widget list
          final items = <Widget>[];
          items.add(_header(bundle));
          int? lastTrip;
          for (final s in stops) {
            if (hasMultipleTrips && s.tripIndex != lastTrip) {
              items.add(_TripDivider(tripIndex: s.tripIndex));
              lastTrip = s.tripIndex;
            }
            final isCurrent = s.stopId == bundle.task?.currentStopId;
            items.add(_StopTile(stop: s, highlight: isCurrent));
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(todayBundleProvider);
              await ref.read(todayBundleProvider.future);
            },
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, idx) => items[idx],
            ),
          );
        },
      ),
    );
  }

  Widget _header(TodayBundle b) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: SigmileColors.brandSoft,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.route_outlined, color: SigmileColors.brand),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '今日路線總覽',
                  style: TextStyle(
                    color: SigmileColors.brandDark,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '完成 ${b.completedCount} / ${b.totalCount} 站',
                  style: const TextStyle(
                    color: SigmileColors.textSecond,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TripDivider extends StatelessWidget {
  final int tripIndex;
  const _TripDivider({required this.tripIndex});

  @override
  Widget build(BuildContext context) {
    final label = tripIndex == 1 ? '第 1 趟（上午）' : '第 $tripIndex 趟';
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 2),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: SigmileColors.brand,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Divider(
              color: SigmileColors.cardBorder,
              thickness: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _StopTile extends StatelessWidget {
  final DeliveryTaskStop stop;
  final bool highlight;
  const _StopTile({required this.stop, required this.highlight});

  @override
  Widget build(BuildContext context) {
    final eta = stop.plannedArrivalAt;
    final etaStr =
        eta == null ? '—' : DateFormat('HH:mm').format(eta.toLocal());
    final shopName = stop.stop?.name ?? '(未命名)';
    final address = stop.stop?.address ?? '';
    final isDone = stop.status == DeliveryTaskStop.statusCompleted;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: highlight
              ? SigmileColors.brand
              : SigmileColors.cardBorder,
          width: highlight ? 1.5 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.push('/stops/${stop.id}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: isDone
                      ? SigmileColors.accentSoft
                      : highlight
                          ? SigmileColors.brandSoft
                          : const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${stop.stopOrder}',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: isDone
                        ? SigmileColors.accentDark
                        : highlight
                            ? SigmileColors.brandDark
                            : SigmileColors.textSecond,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            shopName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        StopStatusChip(status: stop.status),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Icon(Icons.place_outlined,
                            size: 14, color: SigmileColors.textMute),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            address,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              color: SigmileColors.textSecond,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(Icons.schedule,
                            size: 14, color: SigmileColors.textMute),
                        const SizedBox(width: 4),
                        Text(
                          '預計 $etaStr',
                          style: const TextStyle(
                            fontSize: 12,
                            color: SigmileColors.textSecond,
                          ),
                        ),
                        if (stop.onTime == true) ...[
                          const SizedBox(width: 8),
                          const Icon(Icons.check_circle,
                              size: 14, color: SigmileColors.accent),
                          const SizedBox(width: 2),
                          const Text('準時',
                              style: TextStyle(
                                fontSize: 12,
                                color: SigmileColors.accentDark,
                                fontWeight: FontWeight.w600,
                              )),
                        ] else if (stop.onTime == false) ...[
                          const SizedBox(width: 8),
                          const Icon(Icons.report_problem,
                              size: 14, color: SigmileColors.warning),
                          const SizedBox(width: 2),
                          const Text('延誤',
                              style: TextStyle(
                                fontSize: 12,
                                color: SigmileColors.warning,
                                fontWeight: FontWeight.w600,
                              )),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              const Icon(Icons.chevron_right, color: SigmileColors.textMute),
            ],
          ),
        ),
      ),
    );
  }
}
