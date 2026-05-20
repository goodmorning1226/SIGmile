import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app/app.dart';
import 'config/env.dart';
import 'core/supabase_init.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 啟動時印出環境變數，方便在 DEBUG CONSOLE 確認是否吃到 --dart-define
  debugPrint('[env] SUPABASE_URL=${Env.supabaseUrl.isEmpty ? "(empty)" : Env.supabaseUrl}');
  debugPrint('[env] SUPABASE_ANON_KEY='
      '${Env.supabaseAnonKey.isEmpty ? "(empty)" : "(${Env.supabaseAnonKey.length} chars)"}');
  debugPrint('[env] API_BASE_URL=${Env.apiBaseUrl.isEmpty ? "(auto by platform)" : Env.apiBaseUrl}');
  debugPrint('[env] TOMTOM_API_KEY='
      '${Env.tomtomApiKey.isEmpty ? "(empty — 地圖會 fallback 成直線估算)" : "(${Env.tomtomApiKey.length} chars)"}');

  if (!Env.isConfigured) {
    runApp(const _ConfigErrorApp());
    return;
  }

  // 載入 zh_TW 的日期格式資料，DateFormat('...', 'zh_TW') 才不會丟 LocaleDataException
  await initializeDateFormatting('zh_TW');
  await initSupabase();
  runApp(const ProviderScope(child: SigmileDriverApp()));
}

class _ConfigErrorApp extends StatelessWidget {
  const _ConfigErrorApp();
  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: Scaffold(
        body: Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '尚未設定 Supabase',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 12),
                Text(
                  '請以 --dart-define 傳入 SUPABASE_URL 與 SUPABASE_ANON_KEY。\n'
                  '範例見 README。',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
