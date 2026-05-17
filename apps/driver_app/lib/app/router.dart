import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/supabase_init.dart';
import '../pages/current_stop_page.dart';
import '../pages/exception_report_page.dart';
import '../pages/login_page.dart';
import '../pages/navigation_map_page.dart';
import '../pages/profile_page.dart';
import '../pages/stop_list_page.dart';
import '../pages/today_route_page.dart';
import '../providers/auth_provider.dart';

final routerProvider = Provider<GoRouter>((ref) {
  // 訂閱 auth state；每次變更時 router 會重 evaluate redirect
  ref.watch(authStateProvider);

  return GoRouter(
    initialLocation: '/today',
    redirect: (context, state) {
      final session = supabase.auth.currentSession;
      final isLoggingIn = state.matchedLocation == '/login';
      if (session == null) return isLoggingIn ? null : '/login';
      if (isLoggingIn) return '/today';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (_, __) => const LoginPage(),
      ),
      GoRoute(
        path: '/today',
        builder: (_, __) => const TodayRoutePage(),
      ),
      GoRoute(
        path: '/stops',
        builder: (_, __) => const StopListPage(),
        routes: [
          GoRoute(
            path: ':taskStopId',
            builder: (_, s) =>
                CurrentStopPage(taskStopId: s.pathParameters['taskStopId']!),
            routes: [
              GoRoute(
                path: 'navigate',
                builder: (_, s) => NavigationMapPage(
                  taskStopId: s.pathParameters['taskStopId']!,
                ),
              ),
              GoRoute(
                path: 'exception',
                builder: (_, s) => ExceptionReportPage(
                  taskStopId: s.pathParameters['taskStopId']!,
                ),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/profile',
        builder: (_, __) => const ProfilePage(),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(child: Text('Route not found: ${state.uri}')),
    ),
  );
});
