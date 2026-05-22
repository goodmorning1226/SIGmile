import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../app/theme.dart';
import '../models/delivery_task_stop.dart';
import '../models/stop.dart';
import '../providers/service_providers.dart';
import '../providers/today_task_provider.dart';
import '../widgets/api_error_view.dart';
import '../widgets/loading_view.dart';
import '../widgets/primary_action_button.dart';
import '../widgets/stop_status_chip.dart';
import '../widgets/tomtom_map_view.dart';

/// App 內多站 turn-by-turn 導航頁。
///
/// 顯示模式：
///   - 上半：[TomTomMapView]（地圖 + 路線 + 所有 stop pins + GPS 藍點 + banner）
///   - 下半：當前 active stop 資訊 + 操作按鈕
///
/// 邏輯：
///   - 入頁帶一個 taskStopId → 從這站開始往後**所有 pending stops** 一次餵給地圖
///   - 抵達 callback `onStopArrived(index)` → markArrived(stops[index].id) →
///     activeIndex 自動 ++，地圖切換高亮到下一站
///   - 全部抵達 → 自動回 /today，讓 driver 在那邊按各站「完成配送」收尾
class NavigationMapPage extends ConsumerStatefulWidget {
  final String taskStopId;
  const NavigationMapPage({super.key, required this.taskStopId});

  @override
  ConsumerState<NavigationMapPage> createState() => _NavigationMapPageState();
}

class _NavigationMapPageState extends ConsumerState<NavigationMapPage> {
  int _activeIndex = 0;
  bool _markingArrived = false;

  Future<void> _onStopArrived(int idx, List<DeliveryTaskStop> taskStops) async {
    if (idx >= taskStops.length) return;
    if (_markingArrived) return;
    setState(() => _markingArrived = true);
    try {
      final ts = taskStops[idx];
      await ref.read(driverTaskServiceProvider).markArrived(ts.id);
      ref.invalidate(todayBundleProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('GPS 偵測抵達 · ${ts.stop?.name ?? "站"}')),
      );
      // 若還有下一站 → 推進；否則回 today
      if (idx + 1 < taskStops.length) {
        setState(() => _activeIndex = idx + 1);
      } else {
        if (mounted) context.go('/today');
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('標記抵達失敗：$e')),
      );
    } finally {
      if (mounted) setState(() => _markingArrived = false);
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
          // 用 pop 自然回上一頁，保留整個 Navigator stack。
          // 上次用 context.go() 會 reset stack，導致再往回時無法回到主頁。
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/stops/${widget.taskStopId}');
            }
          },
        ),
      ),
      body: bundleAsync.when(
        loading: () => const LoadingView(),
        error: (e, _) => ApiErrorView(
          error: e,
          onRetry: () => ref.invalidate(todayBundleProvider),
        ),
        data: (bundle) {
          // 從 taskStopId 對應的位置起，往後拉所有未結案的 task stops（並過濾無座標）
          final startIdx =
              bundle.stops.indexWhere((s) => s.id == widget.taskStopId);
          if (startIdx < 0) {
            return const Center(
              child: Text('找不到此站',
                  style: TextStyle(color: SigmileColors.textMute)),
            );
          }
          final upcomingTaskStops = <DeliveryTaskStop>[];
          for (int i = startIdx; i < bundle.stops.length; i++) {
            final ts = bundle.stops[i];
            if (ts.isTerminal) continue;
            if (ts.stop?.lat == null) continue;
            upcomingTaskStops.add(ts);
          }
          if (upcomingTaskStops.isEmpty) {
            return const Center(
              child: Text('沒有要去的站（全部已完成或無座標）',
                  style: TextStyle(color: SigmileColors.textMute)),
            );
          }
          final stops = upcomingTaskStops
              .map((ts) => ts.stop!)
              .toList(growable: false);
          // 把 _activeIndex clamp 在範圍內（bundle refresh 後可能少了幾站）
          final activeIdx = _activeIndex.clamp(0, stops.length - 1);
          final activeTs = upcomingTaskStops[activeIdx];

          return _body(context, upcomingTaskStops, stops, activeIdx, activeTs);
        },
      ),
    );
  }

  Widget _body(
    BuildContext context,
    List<DeliveryTaskStop> taskStops,
    List<Stop> stops,
    int activeIdx,
    DeliveryTaskStop activeTs,
  ) {
    final stop = activeTs.stop!;
    final etaStr = activeTs.plannedArrivalAt == null
        ? '—'
        : DateFormat('HH:mm').format(activeTs.plannedArrivalAt!.toLocal());

    // Navigation 模式 layout：地圖佔約 80%，下方緊湊 stop info + 主操作
    return Column(
      children: [
        // ───── 上方：地圖（佔大部分螢幕） ─────
        Expanded(
          flex: 8,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
            child: TomTomMapView(
              stops: stops,
              activeIndex: activeIdx,
              routesService: ref.watch(tomtomRoutesServiceProvider),
              voiceService: ref.watch(voiceNavigationServiceProvider),
              onStopArrived: (i) => _onStopArrived(i, taskStops),
            ),
          ),
        ),
        // ───── 下方：緊湊 stop card + 大按鈕 ─────
        Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          decoration: const BoxDecoration(
            color: Colors.white,
            boxShadow: [
              BoxShadow(
                color: Color(0x14000000),
                blurRadius: 8,
                offset: Offset(0, -2),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 一行 stop 資訊
              Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: SigmileColors.brandSoft,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${activeTs.stopOrder}',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: SigmileColors.brandDark,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          stop.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          '預計 $etaStr · 第 ${activeIdx + 1}/${stops.length} 站',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            color: SigmileColors.textSecond,
                          ),
                        ),
                      ],
                    ),
                  ),
                  StopStatusChip(status: activeTs.status),
                  // 三點選單：異常 / 外部 Maps
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert),
                    onSelected: (v) async {
                      switch (v) {
                        case 'external':
                          if (stop.lat == null) return;
                          final ok = await ref
                              .read(externalNavLauncherProvider)
                              .launchTo(stop);
                          if (!ok && context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('無法開啟外部 Google Maps')),
                            );
                          }
                          break;
                        case 'exception':
                          context.push('/stops/${activeTs.id}/exception');
                          break;
                      }
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(
                        value: 'external',
                        child: Row(children: [
                          Icon(Icons.open_in_new, size: 18, color: SigmileColors.brand),
                          SizedBox(width: 8),
                          Text('用 Google Maps app'),
                        ]),
                      ),
                      const PopupMenuItem(
                        value: 'exception',
                        child: Row(children: [
                          Icon(Icons.report_problem_outlined, size: 18, color: SigmileColors.danger),
                          SizedBox(width: 8),
                          Text('回報異常'),
                        ]),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // 主按鈕：手動標記抵達
              PrimaryActionButton(
                label: '手動標記抵達',
                icon: Icons.flag_circle,
                loading: _markingArrived,
                onPressed: activeTs.isTerminal
                    ? null
                    : () => _onStopArrived(activeIdx, taskStops),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

