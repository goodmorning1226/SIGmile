import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../providers/service_providers.dart';
import '../providers/today_task_provider.dart';
import '../widgets/primary_action_button.dart';

class _Reason {
  final String key;
  final String label;
  final IconData icon;
  const _Reason(this.key, this.label, this.icon);
}

const _reasons = <_Reason>[
  _Reason('traffic_delay',  '交通延誤',   Icons.directions_car_outlined),
  _Reason('store_closed',   '門市未開',   Icons.store_mall_directory_outlined),
  _Reason('no_parking',     '無法停車',   Icons.local_parking_outlined),
  _Reason('cargo_issue',    '貨物異常',   Icons.inventory_2_outlined),
  _Reason('customer_issue', '客戶問題',   Icons.person_outlined),
  _Reason('other',          '其他',       Icons.more_horiz),
];

class ExceptionReportPage extends ConsumerStatefulWidget {
  final String taskStopId;
  const ExceptionReportPage({super.key, required this.taskStopId});

  @override
  ConsumerState<ExceptionReportPage> createState() => _ExceptionReportPageState();
}

class _ExceptionReportPageState extends ConsumerState<ExceptionReportPage> {
  String? _reason;
  final _noteCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_reason == null) return;
    setState(() => _submitting = true);
    try {
      await ref.read(driverTaskServiceProvider).reportException(
        taskStopId: widget.taskStopId,
        reason: _reason!,
        note: _noteCtrl.text.trim().isEmpty ? null : _noteCtrl.text.trim(),
      );
      ref.invalidate(todayBundleProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已回報異常')),
      );
      // 回到清單頁
      context.go('/stops');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('回報失敗：$e')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('回報異常')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            '請選擇異常原因',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: _reasons.map((r) {
              final selected = r.key == _reason;
              return InkWell(
                borderRadius: BorderRadius.circular(999),
                onTap: () => setState(() => _reason = r.key),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: selected ? SigmileColors.brandSoft : Colors.white,
                    border: Border.all(
                      color: selected
                          ? SigmileColors.brand
                          : SigmileColors.cardBorder,
                      width: selected ? 1.5 : 1,
                    ),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        r.icon,
                        size: 18,
                        color: selected
                            ? SigmileColors.brandDark
                            : SigmileColors.textSecond,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        r.label,
                        style: TextStyle(
                          fontSize: 14,
                          color: selected
                              ? SigmileColors.brandDark
                              : SigmileColors.textPrimary,
                          fontWeight: selected
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),

          const SizedBox(height: 28),

          const Text(
            '備註（選填）',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _noteCtrl,
            maxLines: 4,
            maxLength: 300,
            decoration: const InputDecoration(
              hintText: '請描述狀況，例如：到達後門市未開門，已聯絡店長',
            ),
          ),

          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFBEB),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFFDE68A)),
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline,
                    color: SigmileColors.warning, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '送出後此站會標記為 failed，系統會自動跳到下一站',
                    style: TextStyle(
                      fontSize: 12,
                      color: SigmileColors.warning,
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),
          PrimaryActionButton(
            label: '送出異常回報',
            icon: Icons.send,
            loading: _submitting,
            color: SigmileColors.danger,
            onPressed: _reason == null ? null : _submit,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => context.pop(),
            icon: const Icon(Icons.close),
            label: const Text('取消'),
          ),
        ],
      ),
    );
  }
}
