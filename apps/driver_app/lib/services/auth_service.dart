import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/supabase_init.dart';
import '../models/profile.dart';

class AuthService {
  Stream<AuthState> get authStateChanges => supabase.auth.onAuthStateChange;

  Session? get currentSession => supabase.auth.currentSession;
  User? get currentUser => supabase.auth.currentUser;

  /// 登入，並驗證 profile.role == 'driver'。
  /// 若不是 driver 會自動 signOut 並丟 Exception。
  Future<Profile> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final res = await supabase.auth
        .signInWithPassword(email: email.trim(), password: password);
    final user = res.user;
    if (user == null) {
      throw const AuthException('登入失敗：未取得使用者');
    }

    final profile = await fetchMyProfile();
    if (profile == null) {
      await signOut();
      throw const AuthException('尚未建立 profile，請聯絡管理員');
    }
    if (!profile.isDriver) {
      await signOut();
      throw const AuthException('此帳號不是物流士，請改用主管後台登入');
    }
    return profile;
  }

  Future<Profile?> fetchMyProfile() async {
    final user = supabase.auth.currentUser;
    if (user == null) return null;
    final row = await supabase
        .from('profiles')
        .select(
          'id, role, full_name, employee_code, phone, '
          'distribution_center_id, service_area_id',
        )
        .eq('id', user.id)
        .maybeSingle();
    if (row == null) return null;
    return Profile.fromMap(row);
  }

  Future<void> signOut() => supabase.auth.signOut();
}
