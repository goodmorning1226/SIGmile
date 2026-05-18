import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../app/theme.dart';
import '../config/env.dart';
import '../models/delivery_task_stop.dart';
import '../models/stop.dart';
import '../providers/service_providers.dart';
import '../providers/today_task_provider.dart';
import '../widgets/api_error_view.dart';
import '../widgets/loading_view.dart';
import '../widgets/primary_action_button.dart';
import '../widgets/stop_status_chip.dart';
import '../widgets/tomtom_map_view.dart';

/// App 內導航頁：
///   - 上半：[TomTomMapView]（flutter_map + TomTom tile + 路線 polyline + GPS 藍點）
///   - 下半：站點資訊 + 「已抵達」「外部導航」「回報異常」按鈕
///   - **抵達自動觸發**：地圖訂閱 GPS，<50m 就呼叫 [_handleArrived]
class NavigationMapPage extends ConsumerStatefulWidget {
  final String taskStopId;
  const NavigationMapPage({super.key, required this.taskStopId});

  @override
  ConsumerState<NavigationMapPage> createState() => _NavigationMapPageState();
}

class _NavigationMapPageState extends ConsumerState<NavigationMapPage> {
  bool _arriving = false;
  bool _autoArrivalHandled = false;

  Future<void> _handleArrived({bool fromGps = false}) async {
    if (_autoArrivalHandled && fromGps) return;
    _autoArrivalHandled = true;

    setState(() => _arriving = true);
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await ref
          .read(driverTaskServiceProvider)
          .markArrived(widget.taskStopId);
      ref.invalidate(todayBundleProvider);
      if (!mounted) return;
      context.go('/stops/${widget.taskStopId}');
      messenger?.showSnackBar(
        SnackBar(
          content: Text(fromGps ? 'GPS 偵測抵達 · 已標記' : '已標記為抵達'),
        ),
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
            if (s.id == widget.taskStopId) {
              ts = s;
              break;
            }
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

  Widget _body(BuildContext context, DeliveryTaskStop ts, Stop stop) {
    final etaStr = ts.plannedArrivalAt == null
        ? '—'
        : DateFormat('HH:mm').format(ts.plannedArrivalAt!.toLocal());

    return Column(
      children: [
        Expanded(
          flex: 5,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TomTomMapView(
              stop: stop,
              routesService: ref.watch(tomtomRoutesServiceProvider),
              onArrived: () => _handleArrived(fromGps: true),
            ),
          ),
        ),
        Expanded(
          flex: 4,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
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
                    onPressed: ts.isTerminal ? null : () => _handleArrived(),
                  ),
                  const SizedBox(height: 10),
                  // 備援：跳外部 Google Maps app（要 turn-by-turn 語音時用）
                  OutlinedButton.icon(
                    onPressed: stop.lat == null
                        ? null
                        : () async {
                            final ok = await ref
                                .read(externalNavLauncherProvider)
                                .launchTo(stop);
                            if (!ok && context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content:
                                      Text('無法開啟外部 Google Maps（未安裝或座標缺失）'),
                                ),
                              );
                            }
                          },
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('用 Google Maps 開啟（含語音導航）'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: SigmileColors.brand,
                      side: const BorderSide(color: SigmileColors.brand),
                    ),
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
                  _StatusBanner(),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _StatusBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final hasKey = Env.hasTomTomKey;
    String text;
    Color bg;
    Color fg;
    IconData icon;

    if (!hasKey) {
      text = '尚未設定 TOMTOM_API_KEY，地圖會顯示 setup 提示';
      bg = const Color(0xFFFEF3C7);
      fg = SigmileColors.brandDark;
      icon = Icons.key_off;
    } else {
      text = '使用 TomTom Maps + Routes API · 抵達 50m 內自動回報';
      bg = const Color(0xFFDCFCE7);
      fg = const Color(0xFF166534);
      icon = Icons.check_circle_outline;
    }

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 11, color: fg),
            ),
          ),
        ],
      ),
    );
  }
}
