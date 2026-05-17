import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../app/theme.dart';
import '../models/delivery_task_stop.dart';
import '../providers/service_providers.dart';
import '../providers/today_task_provider.dart';
import '../widgets/api_error_view.dart';
import '../widgets/loading_view.dart';
import '../widgets/map_placeholder.dart';
import '../widgets/primary_action_button.dart';
import '../widgets/stop_status_chip.dart';

/// App 內導航頁：取代過去開啟外部 Google Maps 的行為。
///   - 顯示地圖佔位（MapPlaceholder）
///   - 顯示目前要前往的停靠點資訊
///   - 提供「已抵達」「回報異常」「返回」按鈕
class NavigationMapPage extends ConsumerStatefulWidget {
  final String taskStopId;
  const NavigationMapPage({super.key, required this.taskStopId});

  @override
  ConsumerState<NavigationMapPage> createState() => _NavigationMapPageState();
}

class _NavigationMapPageState extends ConsumerState<NavigationMapPage> {
  bool _arriving = false;

  Future<void> _markArrived() async {
    setState(() => _arriving = true);
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await ref
          .read(driverTaskServiceProvider)
          .markArrived(widget.taskStopId);
      ref.invalidate(todayBundleProvider);
      if (!mounted) return;
      // 完成導航後回到 CurrentStopPage，讓 driver 進行「完成配送」步驟
      context.go('/stops/${widget.taskStopId}');
      messenger?.showSnackBar(
        const SnackBar(content: Text('已標記為抵達')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('操作失敗：$e')),
      );
    } finally {
      if (mounted) setState(() => _arriving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bundleAsync = ref.watch(todayBundleProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('導航中'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/stops/${widget.taskStopId}'),
        ),
      ),
      body: bundleAsync.when(
        loading: () => const LoadingView(),
        error: (e, _) => ApiErrorView(
          error: e,
          onRetry: () => ref.invalidate(todayBundleProvider),
        ),
        data: (bundle) {
          DeliveryTaskStop? ts;
          for (final s in bundle.stops) {
            if (s.id == widget.taskStopId) { ts = s; break; }
          }
          if (ts == null || ts.stop == null) {
            return const Center(
              child: Text(
                '找不到此站',
                style: TextStyle(color: SigmileColors.textMute),
              ),
            );
          }
          return _body(context, ts, ts.stop!);
        },
      ),
    );
  }

  Widget _body(BuildContext context, DeliveryTaskStop ts, stop) {
    final etaStr = ts.plannedArrivalAt == null
        ? '—'
        : DateFormat('HH:mm').format(ts.plannedArrivalAt!.toLocal());

    return Column(
      children: [
        // 地圖區（上半）
        Expanded(
          flex: 5,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: MapPlaceholder(
              stop: stop,
              etaText: '預計抵達 $etaStr',
            ),
          ),
        ),

        // 資訊 + 操作（下半）
        Expanded(
          flex: 4,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // stop 資訊
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 36,
                                height: 36,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: SigmileColors.brandSoft,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  '${ts.stopOrder}',
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    color: SigmileColors.brandDark,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  stop.name,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              StopStatusChip(status: ts.status),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              const Icon(Icons.place_outlined,
                                  size: 14, color: SigmileColors.textMute),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  stop.address,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    color: SigmileColors.textSecond,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.schedule,
                                  size: 14, color: SigmileColors.textMute),
                              const SizedBox(width: 4),
                              Text(
                                '預計到達 $etaStr',
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: SigmileColors.textSecond,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 12),

                  PrimaryActionButton(
                    label: '已抵達',
                    icon: Icons.flag_circle,
                    loading: _arriving,
                    onPressed: ts.isTerminal ? null : _markArrived,
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: ts.isTerminal
                        ? null
                        : () => context.push(
                            '/stops/${widget.taskStopId}/exception'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: SigmileColors.danger,
                      side: const BorderSide(color: SigmileColors.danger),
                    ),
                    icon: const Icon(Icons.report_problem_outlined),
                    label: const Text('回報異常'),
                  ),

                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7ED),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFED7AA)),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.info_outline,
                            size: 14, color: SigmileColors.brandDark),
                        SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            '此導航畫面為佔位，未來會接 Google Maps Navigation SDK 顯示實際即時路線',
                            style: TextStyle(
                              fontSize: 11,
                              color: SigmileColors.brandDark,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
