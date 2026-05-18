/// 用 --dart-define 傳入：
///   flutter run \
///     --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=eyJhbGciOi... \
///     --dart-define=TOMTOM_API_KEY=xxxxxxxxxxxxxxxx
///
/// API_BASE_URL 用來連自架的 Next.js API。
///
/// TOMTOM_API_KEY：
///   - 申請：https://developer.tomtom.com/ 註冊（免信用卡，免費 2500 calls/day）
///   - 用途：
///       1. Map tile URL 帶 key (`...?key=$key`)
///       2. Routing API 呼叫 (`/routing/1/calculateRoute/...?key=$key`)
///   - **沒設定也能編譯**：NavigationMapView 會顯示 setup 提示
class Env {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const tomtomApiKey =
      String.fromEnvironment('TOMTOM_API_KEY');

  static bool get isConfigured =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;

  static bool get hasTomTomKey => tomtomApiKey.isNotEmpty;
}
