import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/api_config.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/driver_location_service.dart';
import '../services/driver_task_service.dart';
import '../services/navigation_service.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  final url = ApiConfig.resolveBaseUrl();
  debugPrint('[api] base URL = $url');
  return ApiClient(url);
});

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

final driverTaskServiceProvider = Provider<DriverTaskService>((ref) {
  return DriverTaskService(ref.watch(apiClientProvider));
});

final driverLocationServiceProvider = Provider<DriverLocationService>((ref) {
  return DriverLocationService(ref.watch(apiClientProvider));
});

final navigationServiceProvider =
    Provider<NavigationService>((ref) => MockNavigationService());
