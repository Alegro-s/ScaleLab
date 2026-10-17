import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';

const List<String> _stages = [
  'Загружаем снимки…',
  'Ищем эталон и считаем масштаб…',
  'Выделяем образец на снимке…',
  'Считаем площадь и сравниваем…',
  'Проверяем и формируем отчёт…',
];

class NewReportScreen extends StatefulWidget {
  const NewReportScreen({super.key, required this.api, required this.onCreated});

  final Api api;
  final Future<void> Function(ReportSummary report) onCreated;

  @override
  State<NewReportScreen> createState() => _NewReportScreenState();
}

class _NewReportScreenState extends State<NewReportScreen> {
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _title = TextEditingController();
  final List<XFile?> _photos = <XFile?>[null, null];
  bool _busy = false;
  int _stage = 0;
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    _title.dispose();
    super.dispose();
  }

  bool get _ready => _photos.any((p) => p != null);

  Future<void> _pick(int slot, ImageSource source) async {
    try {
      final file = await _picker.pickImage(
        source: source,
        maxWidth: AppConfig.maxPhotoSide,
        maxHeight: AppConfig.maxPhotoSide,
        imageQuality: 92,
      );
      if (file != null && mounted) setState(() => _photos[slot] = file);
    } catch (_) {
      if (mounted) _message('Не удалось получить фото. Проверьте разрешения приложения.');
    }
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _submit() async {
    final photos = _photos.whereType<XFile>().toList();
    if (photos.isEmpty) return;
    setState(() {
      _busy = true;
      _stage = 0;
    });
    _ticker = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted && _stage < _stages.length - 1) setState(() => _stage++);
    });
    try {
      final report = await widget.api.createReport(photos, _title.text);
      if (!mounted) return;
      setState(() {
        _photos[0] = null;
        _photos[1] = null;
        _title.clear();
      });
      await widget.onCreated(report);
    } on ApiException catch (e) {
      if (mounted) await _showError(e.message);
    } finally {
      _ticker?.cancel();
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showError(String message) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.error_outline, color: failColor),
        title: const Text('Отчёт не составлен'),
        content: Text(message),
        actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Понятно'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
          children: [
            Text('Новый отчёт', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(
              'Снимите образец рядом с эталоном или загрузите готовые фото. Два снимка система сравнит между собой.',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            _hint(context),
            const SizedBox(height: 16),
            _slot(0, 'Образец 1'),
            const SizedBox(height: 12),
            _slot(1, 'Образец 2 (для сравнения)'),
            const SizedBox(height: 16),
            TextField(
              controller: _title,
              maxLength: 120,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(labelText: 'Название (необязательно)', counterText: ''),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _ready && !_busy ? _submit : null,
              icon: const Icon(Icons.assignment_turned_in_outlined),
              label: const Text('Составить отчёт'),
            ),
          ],
        ),
        if (_busy) _progress(context),
      ],
    );
  }

  Widget _hint(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: brand.withAlpha(24), borderRadius: BorderRadius.circular(16)),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, color: brand, size: 20),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'В кадре должен быть эталон: квадратный маркер или шахматный квадрат. По нему считается масштаб и площадь в мм².',
              style: TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Widget _slot(int slot, String label) {
    final photo = _photos[slot];
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: Colors.white,
      shape: cardShape,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (photo != null)
            Stack(
              children: [
                AspectRatio(aspectRatio: 4 / 3, child: Image.file(File(photo.path), fit: BoxFit.cover, width: double.infinity)),
                Positioned(
                  top: 8,
                  right: 8,
                  child: IconButton.filledTonal(
                    onPressed: _busy ? null : () => setState(() => _photos[slot] = null),
                    icon: const Icon(Icons.close),
                    tooltip: 'Убрать фото',
                  ),
                ),
              ],
            ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () => _pick(slot, ImageSource.camera),
                        icon: const Icon(Icons.photo_camera_outlined),
                        label: Text(photo == null ? 'Снять' : 'Переснять'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () => _pick(slot, ImageSource.gallery),
                        icon: const Icon(Icons.photo_library_outlined),
                        label: const Text('Из галереи'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _progress(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black54,
        child: Center(
          child: Card(
            elevation: 0,
            color: Colors.white,
            shape: cardShape,
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: SizedBox(
                width: 260,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 20),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 250),
                      child: Text(_stages[_stage], key: ValueKey<int>(_stage), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                    const SizedBox(height: 8),
                    Text('Обычно это занимает до минуты', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 12)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
