import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';
import 'report_view.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.api});

  final Api api;

  @override
  State<HistoryScreen> createState() => HistoryScreenState();
}

class HistoryScreenState extends State<HistoryScreen> {
  late Future<List<HistoryItem>> _future = widget.api.history();

  void reload() {
    if (!mounted) return;
    setState(() => _future = widget.api.history());
  }

  Future<bool> _confirmDelete(HistoryItem item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Удалить отчёт?'),
        content: Text('«${item.title}» будет удалён вместе со снимками и версиями.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Отмена')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Удалить')),
        ],
      ),
    );
    if (ok != true) return false;
    try {
      await widget.api.delete(item.id);
      return true;
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return false;
    }
  }

  Future<void> _open(HistoryItem item) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ReportScreen(api: widget.api, id: item.id)));
    reload();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<HistoryItem>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snap.hasError) return ErrorView(message: snap.error.toString(), onRetry: reload);
        final items = snap.data ?? const <HistoryItem>[];
        return RefreshIndicator(
          onRefresh: () async {
            reload();
            await _future;
          },
          child: items.isEmpty
              ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: const [
                    SizedBox(height: 160),
                    Icon(Icons.history, size: 56, color: Colors.grey),
                    SizedBox(height: 12),
                    Center(child: Text('Отчётов пока нет')),
                  ],
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
                  itemCount: items.length + 1,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, i) {
                    if (i == 0) {
                      return Text('История', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700));
                    }
                    final item = items[i - 1];
                    return Dismissible(
                      key: ValueKey<String>(item.id),
                      direction: DismissDirection.endToStart,
                      confirmDismiss: (_) => _confirmDelete(item),
                      onDismissed: (_) => setState(() => items.remove(item)),
                      background: Container(
                        alignment: Alignment.centerRight,
                        padding: const EdgeInsets.only(right: 24),
                        decoration: BoxDecoration(color: failColor, borderRadius: BorderRadius.circular(20)),
                        child: const Icon(Icons.delete_outline, color: Colors.white),
                      ),
                      child: _tile(context, item),
                    );
                  },
                ),
        );
      },
    );
  }

  Widget _tile(BuildContext context, HistoryItem item) {
    final areas = item.areas.where((a) => a != null).map((a) => '${fmtNum(a, 1)} мм²').join('  ·  ');
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: Colors.white,
      shape: cardShape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _open(item),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(item.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16))),
                  const SizedBox(width: 8),
                  Pill('№${item.number}'),
                ],
              ),
              const SizedBox(height: 4),
              Text(fmtDate(item.createdAt), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
              if (areas.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(areas, style: const TextStyle(fontWeight: FontWeight.w600)),
              ],
              if (item.verdict != null) ...[
                const SizedBox(height: 4),
                Text(item.verdict!, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ],
              const SizedBox(height: 10),
              item.problems == 0 ? const Pill('Проверки пройдены', color: okColor) : Pill('Требует внимания: ${item.problems}', color: warnColor),
            ],
          ),
        ),
      ),
    );
  }
}
