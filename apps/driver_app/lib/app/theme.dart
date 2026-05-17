import 'package:flutter/material.dart';

/// SIGmile 配色：主色橘 (#EA580C)、次要綠 (#059669)。
/// 物流士現場操作 → 字大、按鈕大、對比強。
class SigmileColors {
  static const brand        = Color(0xFFEA580C); // orange-600
  static const brandDark    = Color(0xFFC2410C); // orange-700
  static const brandSoft    = Color(0xFFFFEDD5); // orange-100
  static const accent       = Color(0xFF059669); // emerald-600
  static const accentDark   = Color(0xFF047857);
  static const accentSoft   = Color(0xFFD1FAE5);
  static const danger       = Color(0xFFDC2626);
  static const warning      = Color(0xFFD97706);
  static const neutralBg    = Color(0xFFF6F7FB);
  static const cardBorder   = Color(0xFFE2E8F0);
  static const textPrimary  = Color(0xFF0F172A);
  static const textSecond   = Color(0xFF475569);
  static const textMute     = Color(0xFF94A3B8);
}

ThemeData buildSigmileTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: SigmileColors.brand,
      primary: SigmileColors.brand,
      secondary: SigmileColors.accent,
    ),
    visualDensity: VisualDensity.standard,
  );

  return base.copyWith(
    scaffoldBackgroundColor: SigmileColors.neutralBg,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: SigmileColors.textPrimary,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: SigmileColors.textPrimary,
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: SigmileColors.cardBorder),
      ),
      margin: EdgeInsets.zero,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        backgroundColor: SigmileColors.brand,
        foregroundColor: Colors.white,
        elevation: 0,
        shadowColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        foregroundColor: SigmileColors.textPrimary,
        side: const BorderSide(color: SigmileColors.cardBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: SigmileColors.brand,
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: SigmileColors.cardBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: SigmileColors.cardBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: SigmileColors.brand, width: 1.6),
      ),
    ),
  );
}
