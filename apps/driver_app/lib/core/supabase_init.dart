import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/env.dart';

Future<void> initSupabase() async {
  if (!Env.isConfigured) {
    throw StateError(
      'SUPABASE_URL / SUPABASE_ANON_KEY 未設定。請以 --dart-define 傳入。',
    );
  }
  await Supabase.initialize(
    url: Env.supabaseUrl,
    anonKey: Env.supabaseAnonKey,
    debug: false,
  );
}

/// 全域捷徑
SupabaseClient get supabase => Supabase.instance.client;
