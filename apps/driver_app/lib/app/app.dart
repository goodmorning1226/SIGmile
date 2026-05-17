import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'theme.dart';

class SigmileDriverApp extends ConsumerWidget {
  const SigmileDriverApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'SIGmile',
      debugShowCheckedModeBanner: false,
      theme: buildSigmileTheme(),
      routerConfig: router,
    );
  }
}
