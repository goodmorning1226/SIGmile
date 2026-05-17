import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/profile.dart';
import 'service_providers.dart';

/// 監聽 Supabase auth 狀態變化（用於 router 自動 redirect）。
final authStateProvider = StreamProvider<AuthState>((ref) {
  final auth = ref.watch(authServiceProvider);
  return auth.authStateChanges;
});

/// 當前登入者的 profile；登出時為 null。
final myProfileProvider = FutureProvider<Profile?>((ref) async {
  ref.watch(authStateProvider); // 切換帳號時自動 refetch
  final auth = ref.watch(authServiceProvider);
  return auth.fetchMyProfile();
});
