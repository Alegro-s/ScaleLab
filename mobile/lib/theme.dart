import 'package:flutter/material.dart';

const Color brand = Color(0xFF2F72AE);
const Color okColor = Color(0xFF2E7D4F);
const Color warnColor = Color(0xFFB7791F);
const Color failColor = Color(0xFFC0392B);

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: brand, brightness: Brightness.light);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF3F5F9),
    appBarTheme: const AppBarTheme(centerTitle: false, backgroundColor: Color(0xFFF3F5F9), surfaceTintColor: Colors.transparent),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFFE2E6EE))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFFE2E6EE))),
    ),
  );
}

final RoundedRectangleBorder cardShape = RoundedRectangleBorder(
  borderRadius: BorderRadius.circular(20),
  side: const BorderSide(color: Color(0xFFE2E6EE)),
);
