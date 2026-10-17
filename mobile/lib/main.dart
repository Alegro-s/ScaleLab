import 'package:flutter/material.dart';

import 'screens/home.dart';
import 'theme.dart';

void main() {
  runApp(const MasshtabLabApp());
}

class MasshtabLabApp extends StatelessWidget {
  const MasshtabLabApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'МасштабЛаб',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const HomeScreen(),
    );
  }
}
