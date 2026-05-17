import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../providers/service_providers.dart';
import '../services/api_client.dart';

/// 統一處理 API 錯誤畫面：
///   - 401/403（ApiException.isAuth）：顯示「請重新登入」+ 按鈕導向 /login（並 signOut）
///   - 純網路錯誤（statusCode == 0）：顯示「連線失敗 / 重試」
///   - 其他：顯示錯誤訊息 + 重試
class ApiErrorView extends ConsumerWidget {
  final Object error;
  final VoidCallback? onRetry;
  const ApiErrorView({super.key, required this.error, this.onRetry});

  bool get _isAuth => error is ApiException && (error as ApiException).isAuth;
  bool get _isNetwork =>
      error is ApiException && (error as ApiException).isNetwork;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (title, body, primary) = _texts();

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(
            _isAuth ? Icons.lock_outline : Icons.error_outline,
            size: 44,
            color: _isAuth ? SigmileColors.brand : SigmileColors.danger,
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: SigmileColors.textPrimary,
            ),
          ),
          if (body.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                color: SigmileColors.textSecond,
              ),
            ),
          ],
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: () async {
              if (_isAuth) {
                // 把目前的 session 清掉再去 /login，避免 router 又被卡住
                await ref.read(authServiceProvider).signOut();
                if (context.mounted) context.go('/login');
              } else {
                onRetry?.call();
              }
            },
            icon: Icon(_isAuth ? Icons.login : Icons.refresh),
            label: Text(primary),
          ),
        ],
      ),
    );
  }

  (String title, String body, String primary) _texts() {
    if (_isAuth) {
      return (
        '請重新登入',
        '登入狀態已失效或尚未登入，請重新登入後再使用',
        '前往登入',
      );
    }
    if (_isNetwork) {
      return (
        '無法連線到伺服器',
        error.toString(),
        '重試',
      );
    }
    return (
      '載入失敗',
      error.toString(),
      '重試',
    );
  }
}
