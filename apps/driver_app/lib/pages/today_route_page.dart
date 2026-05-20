import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/delivery_task.dart';
import '../models/delivery_task_stop.dart';
import '../providers/auth_provider.dart';
import '../providers/service_providers.dart';
import '../providers/today_task_provider.dart';
import '../widgets/api_error_view.dart';
import '../widgets/loading_view.dart';
import '../widgets/primary_action_button.dart';
import '../widgets/section_header.dart';
import '../widgets/stop_status_chip.dart';

class TodayRoutePage extends ConsumerWidget {
  const TodayRoutePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 監聽 auth state：session 變 null（登出 / token 過期）就推回 /login
    ref.listen<AsyncValue<AuthState>>(authStateProvider, (prev, next) {
      next.whenData((state) {
        if (state.session == null && context.mounted) {
          context.go('/login');
        }
      });
    });

    final bundleAsync = ref.watch(todayBundleProvider);
    final profileAsync = ref.watch(myProfileProvider);

    final dateStr = DateFormat('yyyy/MM/dd (EEE)', 'zh_TW')
        .format(DateTime.now());

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 8,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/images/logo.png',
              width: 28,
              height: 28,
              fit: BoxFit.contain,
            ),
            const SizedBox(width: 8),
            const Text('今日配送'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '個人資料',
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(todayBundleProvider);
          await ref.read(todayBundleProvider.future);
        },
        child: bundleAsync.when(
          loading: () => const LoadingView(message: '載入今日任務…'),
          error: (e, _) => ListView(
            children: [
              const SizedBox(height: 80),
              ApiErrorView(
                error: e,
                onRetry: () => ref.invalidate(todayBundleProvider),
              ),
            ],
          ),
          data: (bundle) {
            final fullName = profileAsync.maybeWhen(
              data: (p) => p?.fullName ?? '物流士',
              orElse: () => '物流士',
            );

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _greetingCard(fullName, dateStr, bundle.task),
                const SizedBox(height: 16),
                _progressCard(bundle),
                const SizedBox(height: 24),
                if (bundle.task == null)
                  _emptyState()
                else ...[
                  const SectionHeader('目前站點'),
                  _currentStopCard(context, bundle),
                  const SizedBox(height: 16),
                  const SectionHeader('下一站'),
                  _nextStopCard(bundle),
                  const SizedBox(height: 24),
                  _primaryActions(context, ref, bundle),
                ],
                const SizedBox(height: 32),
              ],
            );
          },
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Cards
  // --------------------------------------------------------------------------

  Widget _greetingCard(String name, String date, DeliveryTask? task) {
    final statusLabel = switch (task?.status) {
      DeliveryTask.statusPending => '尚未開始',
      DeliveryTask.statusInProgress => '配送中',
      DeliveryTask.statusCompleted => '今日已完成',
      DeliveryTask.statusCancelled => '已取消',
      _ => '今日無任務',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(date,
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 13,
                )),
            const SizedBox(height: 4),
            Text(
              '$name 你好',
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFFFEDD5),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                statusLabel,
                style: const TextStyle(
                  color: Color(0xFFC2410C),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _progressCard(TodayBundle bundle) {
    final done = bundle.completedCount;
    final total = bundle.totalCount;
    final pct = total == 0 ? 0.0 : done / total;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text(
                  '進度',
                  style: TextStyle(
                    color: Color(0xFF64748B),
                    fontSize: 13,
                  ),
                ),
                const Spacer(),
                Text(
                  '$done',
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFFEA580C),
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  '/ $total 站',
                  style: const TextStyle(
                    color: Color(0xFF64748B),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: pct,
                minHeight: 10,
                backgroundColor: const Color(0xFFE2E8F0),
                valueColor:
                    const AlwaysStoppedAnimation(Color(0xFFEA580C)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _currentStopCard(BuildContext context, TodayBundle bundle) {
    final stop = bundle.currentStop ?? bundle.nextPendingStop;
    if (stop == null) return _allDoneCard();
    return _stopRowCard(context, stop);
  }

  Widget _nextStopCard(TodayBundle bundle) {
    final stop = bundle.upcomingStop;
    if (stop == null) {
      return _placeholderCard('已是最後一站，或已全部完成');
    }
    return _stopRowCard(null, stop, compact: true);
  }

  Widget _stopRowCard(BuildContext? ctx, DeliveryTaskStop ts,
      {bool compact = false}) {
    final stop = ts.stop;
    final eta = ts.plannedArrivalAt;
    final etaStr = eta == null
        ? '—'
        : DateFormat('HH:mm').format(eta.toLocal());
    final card = Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: ctx == null ? null : () => ctx.push('/stops/${ts.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
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
                      color: const Color(0xFFFFEDD5),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '${ts.stopOrder}',
                      style: const TextStyle(
                        color: Color(0xFFEA580C),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Row(
                      children: [
                        Flexible(
                          child: Text(
                            stop?.name ?? '(未命名)',
                            style: TextStyle(
                              fontSize: compact ? 15 : 17,
                              fontWeight: FontWeight.w700,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (ts.tripIndex >= 2) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFDBEAFE),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              '第 ${ts.tripIndex} 趟',
                              style: const TextStyle(
                                color: Color(0xFF1D4ED8),
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  StopStatusChip(status: ts.status),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(Icons.place_outlined,
                      size: 16, color: Color(0xFF64748B)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      stop?.address ?? '',
                      style: const TextStyle(
                        color: Color(0xFF334155),
                        fontSize: 13,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.access_time,
                      size: 16, color: Color(0xFF64748B)),
                  const SizedBox(width: 6),
                  Text(
                    '預計 $etaStr',
                    style: const TextStyle(
                      color: Color(0xFF334155),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    return card;
  }

  Widget _allDoneCard() {
    return const Card(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 18, vertical: 24),
        child: Row(
          children: [
            Icon(Icons.task_alt, color: Color(0xFF047857)),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                '所有停靠點皆已處理完畢',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _placeholderCard(String text) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 22),
        child: Text(text,
            style: const TextStyle(color: Color(0xFF64748B))),
      ),
    );
  }

  Widget _emptyState() {
    return const Card(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(Icons.inbox_outlined,
                size: 40, color: Color(0xFF94A3B8)),
            SizedBox(height: 8),
            Text('今日尚未派發任務',
                style: TextStyle(fontWeight: FontWeight.w700)),
            SizedBox(height: 4),
            Text(
              '請聯絡主管確認今日是否有配送排程',
              style: TextStyle(color: Color(0xFF64748B)),
            ),
          ],
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  Widget _primaryActions(
      BuildContext context, WidgetRef ref, TodayBundle bundle) {
    final task = bundle.task;
    final current = bundle.currentStop ?? bundle.nextPendingStop;
    final allDone = current == null;

    final actions = <Widget>[];

    if (task != null && task.isPending && !allDone) {
      actions.add(PrimaryActionButton(
        label: '開始配送',
        icon: Icons.play_arrow,
        onPressed: () => _startTask(context, ref, task.id),
      ));
    } else if (task != null && task.isInProgress && current != null) {
      actions.add(PrimaryActionButton(
        label: '繼續目前站點',
        icon: Icons.navigation,
        onPressed: () => context.push('/stops/${current.id}'),
      ));
    }

    actions.add(const SizedBox(height: 12));
    actions.add(OutlinedButton.icon(
      onPressed: () => context.push('/stops'),
      icon: const Icon(Icons.list_alt),
      label: const Text('查看停靠點清單'),
    ));

    actions.add(const SizedBox(height: 8));
    actions.add(_uploadMockLocationButton(context, ref, task?.id));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: actions,
    );
  }

  Widget _uploadMockLocationButton(
      BuildContext context, WidgetRef ref, String? taskId) {
    return TextButton.icon(
      onPressed: () async {
        try {
          final svc = ref.read(driverLocationServiceProvider);
          final p = svc.mockLatLng();
          await svc.updateCurrentLocation(
            lat: p.lat,
            lng: p.lng,
            deliveryTaskId: taskId,
          );
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('已上傳 mock 位置')),
            );
          }
        } catch (e) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('上傳失敗：$e')),
            );
          }
        }
      },
      icon: const Icon(Icons.my_location, size: 18),
      label: const Text('上傳一筆 mock 位置'),
    );
  }

  Future<void> _startTask(
      BuildContext context, WidgetRef ref, String taskId) async {
    try {
      await ref.read(driverTaskServiceProvider).startTask(taskId);
      ref.invalidate(todayBundleProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('啟動失敗：$e')),
        );
      }
    }
  }
}
