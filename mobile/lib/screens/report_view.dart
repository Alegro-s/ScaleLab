import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets.dart';

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, required this.api, required this.id, this.initial});

  final Api api;
  final String id;
  final ReportSummary? initial;

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  late Future<ReportSummary> _future = widget.initial != null ? Future<ReportSummary>.value(widget.initial) : widget.api.report(widget.id);

  void _reload() => setState(() => _future = widget.api.report(widget.id));

  Future<void> _download(String format) async {
    final ok = await launchUrl(widget.api.fileUri(widget.id, format), mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Не удалось открыть файл')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Отчёт')),
      body: FutureBuilder<ReportSummary>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return ErrorView(message: snap.error.toString(), onRetry: _reload);
          return _body(context, snap.data!);
        },
      ),
    );
  }

  Widget _body(BuildContext context, ReportSummary r) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
      children: [
        Text(r.title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Row(
          children: [
            Pill('№${r.number}'),
            const SizedBox(width: 8),
            Pill('v${r.version}'),
            const SizedBox(width: 10),
            Text(fmtDate(r.createdAt), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ],
        ),
        const SizedBox(height: 16),
        if (r.compare != null) ...[_compare(context, r.compare!), const SizedBox(height: 12)],
        for (final s in r.samples) ...[_sample(context, r, s), const SizedBox(height: 12)],
        _checks(r),
        if (r.conclusions.isNotEmpty) ...[
          const SizedBox(height: 12),
          Section(
            title: 'Выводы',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [for (final c in r.conclusions) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(c))],
            ),
          ),
        ],
        const SizedBox(height: 12),
        Section(
          title: 'Файлы отчёта',
          child: Column(
            children: [
              FilledButton.icon(onPressed: () => _download('pdf'), icon: const Icon(Icons.picture_as_pdf_outlined), label: const Text('Открыть PDF')),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => _download('csv'), icon: const Icon(Icons.table_chart_outlined), label: const Text('CSV'))),
                  const SizedBox(width: 10),
                  Expanded(child: OutlinedButton.icon(onPressed: () => _download('zip'), icon: const Icon(Icons.folder_zip_outlined), label: const Text('Всё архивом'))),
                ],
              ),
              const SizedBox(height: 12),
              Text('Контрольная сумма: ${r.sha256.length > 24 ? '${r.sha256.substring(0, 24)}…' : r.sha256}',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _compare(BuildContext context, CompareInfo c) {
    return Section(
      title: 'Сравнение',
      trailing: Pill(c.scalesMatch ? 'Один масштаб' : 'Масштабы разные', color: c.scalesMatch ? okColor : warnColor),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(c.verdict, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          KeyValue('Площадь образца 1', '${fmtNum(c.areaA)} мм²'),
          KeyValue('Площадь образца 2', '${fmtNum(c.areaB)} мм²'),
          KeyValue('Разница по площади', fmtPct(c.areaDeltaPct)),
          KeyValue('Разница по периметру', fmtPct(c.perimeterDeltaPct)),
        ],
      ),
    );
  }

  Widget _sample(BuildContext context, ReportSummary r, SampleInfo s) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: Colors.white,
      shape: cardShape,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 4 / 3,
            child: Image.network(
              widget.api.previewUri(r.id, s.slot).toString(),
              headers: widget.api.imageHeaders,
              fit: BoxFit.cover,
              width: double.infinity,
              loadingBuilder: (c, child, p) => p == null ? child : const Center(child: CircularProgressIndicator()),
              errorBuilder: (c, e, st) => const ColoredBox(color: Color(0xFFE9EDF3), child: Center(child: Icon(Icons.image_not_supported_outlined, color: Colors.grey))),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                const SizedBox(height: 8),
                KeyValue('Площадь', '${fmtNum(s.areaMm2)} мм²'),
                KeyValue('Периметр', '${fmtNum(s.perimeterMm)} мм'),
                KeyValue('Погрешность площади', '±${fmtNum(s.errorMm2)} мм²'),
                KeyValue('Масштаб', '${fmtNum(s.pxPerMm, 1)} px/мм'),
                KeyValue('Выделено областей', '${s.regions}'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _checks(ReportSummary r) {
    return Section(
      title: 'Проверка',
      trailing: r.problems == 0 ? const Pill('Всё в порядке', color: okColor) : Pill('Замечаний: ${r.problems}', color: warnColor),
      child: Column(
        children: [
          for (final c in r.checks)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  StatusIcon(c.status),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(c.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(c.detail, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
