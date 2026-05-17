import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../app/theme.dart';
import '../models/delivery_task_stop.dart';
import '../providers/service_providers.dart';
import '../providers/today_task_provider.dart';
import '../widgets/error_view.dart';
import '../widgets/loading_view.dart';
import '../widgets/primary_action_button.dart';
import '../widgets/stop_status_chip.dart';

class CurrentStopPage extends ConsumerStatefulWidget {
  final String taskStopId;
  const CurrentStopPage({super.key, required this.taskStopId});

  @override
  ConsumerState<CurrentStopPage> createState() => _CurrentStopPageState();
}

class _CurrentStopPageState extends ConsumerState<CurrentStopPage> {
  bool _loadingNav = false;
  bool _loadingArrive = false;
  bool _loadingComplete = false;

  Future<void> _runAction(
      Future<void> Function() body, {
      required String successMsg,
      String? failPrefix,
      void Function()? afterRefresh,
      required void Function(bool) setLoading,
    }) async {
    setLoading(true);
    try {
      await body();
      ref.invalidate(todayBundleProvider);
      await ref.read(todayBundleProvider.future);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(successMsg)),
        );
      }
      afterRefresh?.call();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${failPrefix ?? "操作失敗"}：$e')),
        );
      }
    } finally {
      if (mounted) setLoading(false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bundleAsync = ref.watch(todayBundleProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('目前站點')),
      body: bundleAsync.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
          message: '$e',
          onRetry: () => ref.invalidate(todayBundleProvider),
        ),
        data: (bundle) {
          DeliveryTaskStop? ts;
          for (final s in bundle.stops) {
            if (s.id == widget.taskStopId) { ts = s; break; }
          }
          if (ts == null) {
            return const Center(
              child: Text('找不到此站',
                style: TextStyle(color: SigmileColors.textMute)),
            );
          }
          return _body(context, ts, bundle);
        },
      ),
    );
  }

  Widget _body(BuildContext context, DeliveryTaskStop ts, TodayBundle bundle) {
    final stop = ts.stop;
    final plannedStr = ts.plannedArrivalAt == null
        ? '—'
        : DateFormat('HH:mm').format(ts.plannedArrivalAt!.toLocal());
    final tw = (stop?.timeWindowStart != null && stop?.timeWindowEnd != null)
        ? '${_hm(stop!.timeWindowStart!)} – ${_hm(stop.timeWindowEnd!)}'
        : '—';

    final canMarkNav     = ts.status == DeliveryTaskStop.statusPending;
    final canMarkArrived = ts.status == DeliveryTaskStop.statusPending ||
                           ts.status == DeliveryTaskStop.statusNavigating;
    final canMarkDone    = ts.status == DeliveryTaskStop.statusArrived;
    final canException   = !ts.isTerminal;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // 站點 header
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 44, height: 44,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: SigmileColors.brandSoft,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${ts.stopOrder}',
                        style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800,
                          color: SigmileColors.brandDark,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        stop?.name ?? '(未命名)',
                        style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    StopStatusChip(status: ts.status),
                  ],
                ),
                const SizedBox(height: 14),
                _kvRow(Icons.place_outlined, '地址', stop?.address ?? '—'),
                _kvRow(Icons.schedule, '預估到達', plannedStr),
                _kvRow(Icons.access_time, '服務時窗', tw),
                if (stop?.defaultServiceMinutes != null)
                  _kvRow(Icons.timer_outlined, '預估停留', '${stop!.defaultServiceMinutes} 分'),
                if (stop?.contactPhone != null && stop!.contactPhone!.isNotEmpty)
                  _kvRow(Icons.phone, '門市聯絡', stop.contactPhone!),
                if (stop?.notes != null && stop!.notes!.isNotEmpty)
                  _kvRow(Icons.note_alt_outlined, '備註', stop.notes!),
                if (ts.exceptionReason != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.warning_amber_rounded,
                            color: SigmileColors.danger, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            '異常：${ts.exceptionReason}'
                                '${ts.exceptionNote == null ? "" : "\n${ts.exceptionNote}"}',
                            style: const TextStyle(
                              color: SigmileColors.danger,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                ],
              ],
            ),
          ),
        ),

        const SizedBox(height: 16),

        // 主要按鈕：開啟 App 內導航頁
        PrimaryActionButton(
          label: '開啟導航',
          icon: Icons.navigation,
          loading: _loadingNav,
          onPressed: !canException ? null : () async {
            // 1) 先呼叫後端把這站標記為 navigating（若還沒）
            if (canMarkNav) {
              await _runAction(
                () => ref.read(driverTaskServiceProvider)
                    .markNavigating(ts.id),
                successMsg: '已開始導航',
                failPrefix: '更新狀態失敗',
                setLoading: (v) => setState(() => _loadingNav = v),
              );
            }
            // 2) push 到 App 內導航地圖頁（未來會接 Google Maps SDK）
            if (context.mounted) {
              context.push('/stops/${ts.id}/navigate');
            }
          },
        ),
        const SizedBox(height: 10),

        PrimaryActionButton(
          label: '已抵達',
          icon: Icons.flag_circle_outlined,
          loading: _loadingArrive,
          color: canMarkArrived ? SigmileColors.brand : null,
          onPressed: !canMarkArrived ? null : () => _runAction(
            () => ref.read(driverTaskServiceProvider).markArrived(ts.id),
            successMsg: '已標記為抵達',
            failPrefix: '操作失敗',
            setLoading: (v) => setState(() => _loadingArrive = v),
          ),
        ),
        const SizedBox(height: 10),

        PrimaryActionButton(
          label: '完成配送',
          icon: Icons.check_circle,
          loading: _loadingComplete,
          color: canMarkDone ? SigmileColors.accent : null,
          onPressed: !canMarkDone ? null : () => _runAction(
            () => ref.read(driverTaskServiceProvider).markCompleted(ts.id),
            successMsg: '已完成此站',
            failPrefix: '完成失敗',
            setLoading: (v) => setState(() => _loadingComplete = v),
            afterRefresh: () {
              // 自動跳到下一個 pending stop（若有）
              if (!mounted) return;
              final next = ref.read(todayBundleProvider).asData?.value.nextPendingStop;
              if (next != null && next.id != ts.id) {
                context.go('/stops/${next.id}');
              } else {
                context.go('/today');
              }
            },
          ),
        ),
        const SizedBox(height: 10),

        OutlinedButton.icon(
          onPressed: !canException ? null : () =>
              context.push('/stops/${ts.id}/exception'),
          style: OutlinedButton.styleFrom(
            foregroundColor: SigmileColors.danger,
            side: const BorderSide(color: SigmileColors.danger),
          ),
          icon: const Icon(Icons.report_problem_outlined),
          label: const Text('回報異常'),
        ),

        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF7ED),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFFED7AA)),
          ),
          child: const Row(
            children: [
              Icon(Icons.info_outline,
                  size: 16, color: SigmileColors.brandDark),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  '「開啟導航」目前是 placeholder：未來會在這裡呼叫 Google Maps Navigation SDK。',
                  style: TextStyle(
                    color: SigmileColors.brandDark,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kvRow(IconData icon, String k, String v) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: SigmileColors.textMute),
          const SizedBox(width: 8),
          SizedBox(
            width: 72,
            child: Text(
              k,
              style: const TextStyle(
                color: SigmileColors.textSecond,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              v,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _hm(String s) {
    // server 回傳 time as 'HH:MM:SS'
    return s.length >= 5 ? s.substring(0, 5) : s;
  }
}
