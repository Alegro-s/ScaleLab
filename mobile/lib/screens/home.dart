import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import 'history.dart';
import 'wizard.dart';
import 'report_view.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final Api _api = Api();
  final GlobalKey<HistoryScreenState> _history = GlobalKey<HistoryScreenState>();
  int _index = 0;

  Future<void> _created(ReportSummary report) async {
    _history.currentState?.reload();
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ReportScreen(api: _api, id: report.id, initial: report)));
    _history.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: IndexedStack(
          index: _index,
          children: [
            WizardScreen(api: _api, onCreated: _created),
            HistoryScreen(key: _history, api: _api),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          if (i == 1) _history.currentState?.reload();
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.add_a_photo_outlined), selectedIcon: Icon(Icons.add_a_photo), label: 'Новый отчёт'),
          NavigationDestination(icon: Icon(Icons.history), selectedIcon: Icon(Icons.history_toggle_off), label: 'История'),
        ],
      ),
    );
  }
}
