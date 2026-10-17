import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api.dart';
import '../config.dart';
import '../format.dart';
import '../models.dart';
import '../points_editor.dart';
import '../theme.dart';
import '../widgets.dart';
import '../wizard_models.dart';

const List<String> _titles = ['Фотографии', 'Эталон', 'Единый масштаб', 'Выделение и площадь', 'Сравнение и отчёт'];

class WizardScreen extends StatefulWidget {
  const WizardScreen({super.key, required this.api, required this.onCreated});

  final Api api;
  final Future<void> Function(ReportSummary report) onCreated;

  @override
  State<WizardScreen> createState() => _WizardScreenState();
}

class _WizardScreenState extends State<WizardScreen> {
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _title = TextEditingController();
  final TextEditingController _side = TextEditingController(text: '10');
  final List<Photo> _photos = <Photo>[Photo(), Photo()];
  int _step = 0;
  int _active = 0;
  bool _busy = false;
  String _busyText = '';
  String? _sessionId;
  Map<String, dynamic>? _compare;
  bool _compareLoaded = false;

  @override
  void dispose() {
    _title.dispose();
    _side.dispose();
    super.dispose();
  }

  Photo get _cur => _photos[_active];

  double get _sideMm {
    final v = double.tryParse(_side.text.replaceAll(',', '.'));
    return v == null || v <= 0 ? 10 : v;
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _fail(String message) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.error_outline, color: failColor),
        title: const Text('Не получилось'),
        content: Text(message),
        actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Понятно'))],
      ),
    );
  }

  Future<bool> _run(String text, Future<void> Function() job) async {
    setState(() {
      _busy = true;
      _busyText = text;
    });
    try {
      await job();
      return true;
    } on ApiException catch (e) {
      if (mounted) await _fail(e.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick(int i, ImageSource source) async {
    try {
      final file = await _picker.pickImage(
        source: source,
        maxWidth: AppConfig.maxPhotoSide,
        maxHeight: AppConfig.maxPhotoSide,
        imageQuality: 92,
      );
      if (file == null || !mounted) return;
      final old = _photos[i].sampleId;
      setState(() {
        _photos[i].resetRemote();
        _photos[i].file = file;
        _compareLoaded = false;
      });
      if (old != null) unawaited(widget.api.deleteSample(old).catchError((Object _) {}));
    } catch (_) {
      if (mounted) _toast('Не удалось получить фото. Проверьте разрешения приложения.');
    }
  }

  void _useAnalysis(Photo p, Analysis a) {
    if (a.width > 0) {
      p.width = a.width;
      p.height = a.height;
    }
    final best = a.candidates.isEmpty ? null : a.candidates.first;
    if (a.found && best != null && best.corners.length == 4) {
      p.found = true;
      p.corners = best.corners;
      p.confidence = best.confidence;
      p.pxPerMm = best.pxPerMm;
      p.kind = best.kind;
      p.sideMm = best.sideMm;
      p.warning = best.confidence < 0.75
          ? 'Эталон найден с невысокой уверенностью (${(best.confidence * 100).round()} %). Проверьте границы квадрата.'
          : (a.warnings.isEmpty ? null : a.warnings.first);
    } else {
      p.found = false;
      p.defaultCorners();
      p.confidence = 0;
      p.pxPerMm = 0;
      p.warning = 'Эталон на снимке не найден. Перетащите четыре угла на углы квадрата 1×1 см.';
    }
    p.edited = false;
    p.applied = false;
    p.version++;
  }

  Future<void> _toCalibration() async {
    final ok = await _run('Загружаем снимки и ищем эталон…', () async {
      _sessionId ??= await widget.api.createSession(_title.text.trim().isEmpty ? 'Фото-отчёт ${fmtDate(DateTime.now())}' : _title.text.trim());
      for (var i = 0; i < _photos.length; i++) {
        final p = _photos[i];
        if (p.uploaded) continue;
        final s = await widget.api.uploadPhoto(_sessionId!, i + 1, p.file!);
        p.sampleId = s['id'].toString();
        p.width = (s['width'] as num?)?.toDouble() ?? 0;
        p.height = (s['height'] as num?)?.toDouble() ?? 0;
        _useAnalysis(p, await widget.api.analyze(p.sampleId!, _sideMm));
      }
    });
    if (ok && mounted) setState(() => _step = 1);
  }

  Future<void> _research() async {
    final p = _cur;
    await _run('Ищем эталон…', () async {
      p.sideMm = _sideMm;
      _useAnalysis(p, await widget.api.analyze(p.sampleId!, _sideMm));
    });
    if (mounted) setState(() {});
  }

  Future<void> _apply(Photo p) async {
    p.sideMm = _sideMm;
    final j = await widget.api.setCalibration(p.sampleId!, p.corners, p.sideMm, manual: !p.found || p.edited, kind: p.kind);
    p.pxPerMm = (j['px_per_mm'] as num?)?.toDouble() ?? p.pxPerMm;
    p.confidence = (j['confidence'] as num?)?.toDouble() ?? p.confidence;
    p.applied = true;
    p.version++;
  }

  Future<void> _applyCurrent() async {
    final ok = await _run('Считаем масштаб…', () => _apply(_cur));
    if (ok && mounted) setState(() {});
  }

  Future<void> _toScale() async {
    final ok = await _run('Считаем масштаб…', () async {
      for (final p in _photos) {
        if (!p.applied) await _apply(p);
      }
    });
    if (ok && mounted) setState(() => _step = 2);
  }

  Future<void> _toMeasure() async {
    final ok = await _run('Загружаем замеры…', () async {
      for (final p in _photos) {
        p.measures = await widget.api.measures(p.sampleId!);
      }
    });
    if (ok && mounted) {
      setState(() {
        _active = 0;
        _step = 3;
      });
    }
  }

  Future<void> _autoOutline() async {
    final p = _cur;
    await _run('Ищем контур образца…', () async {
      final pts = await widget.api.autoOutline(p.sampleId!);
      if (pts.length < 3) {
        _toast('Контур не найден. Обведите образец вручную.');
      } else {
        p.draft = pts;
      }
    });
    if (mounted) setState(() {});
  }

  Future<void> _calculate() async {
    final p = _cur;
    if (p.draft.length < 3) return;
    await _run('Считаем площадь…', () async {
      final m = await widget.api.addPolygon(p.sampleId!, p.draft);
      p.measures = <Measure>[...p.measures, m];
      p.draft = <Offset>[];
      _compareLoaded = false;
    });
    if (mounted) setState(() {});
  }

  Future<void> _removeMeasure(Photo p, Measure m) async {
    await _run('Удаляем замер…', () async {
      await widget.api.deleteMeasure(m.id);
      p.measures = p.measures.where((x) => x.id != m.id).toList();
      _compareLoaded = false;
    });
    if (mounted) setState(() {});
  }

  Future<void> _toReport() async {
    await _run('Сравниваем образцы…', () async {
      _compare = await widget.api.compare(_sessionId!);
      _compareLoaded = true;
    });
    if (mounted) setState(() => _step = 4);
  }

  Future<void> _save() async {
    ReportSummary? summary;
    final ok = await _run('Формируем отчёт…', () async {
      final title = _title.text.trim().isEmpty ? 'Фото-отчёт ${fmtDate(DateTime.now())}' : _title.text.trim();
      await widget.api.saveReport(_sessionId!, title);
      summary = await widget.api.report(_sessionId!);
    });
    if (!ok || summary == null || !mounted) return;
    final report = summary!;
    _reset(deleteRemote: false);
    await widget.onCreated(report);
  }

  Future<void> _quick() async {
    final files = _photos.map((p) => p.file).whereType<XFile>().toList();
    if (files.isEmpty) return;
    ReportSummary? summary;
    final ok = await _run('Система составляет отчёт сама…', () async {
      summary = await widget.api.createReport(files, _title.text);
    });
    if (!ok || summary == null || !mounted) return;
    final report = summary!;
    _reset(deleteRemote: true);
    await widget.onCreated(report);
  }

  void _reset({required bool deleteRemote}) {
    final sid = _sessionId;
    if (deleteRemote && sid != null) unawaited(widget.api.delete(sid).catchError((Object _) {}));
    setState(() {
      _sessionId = null;
      _step = 0;
      _active = 0;
      _compare = null;
      _compareLoaded = false;
      for (final p in _photos) {
        p.resetRemote();
        p.file = null;
      }
      _title.clear();
    });
  }

  Future<void> _cancel() async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Начать заново?'),
        content: const Text('Текущие снимки и замеры будут удалены.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Нет')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Да')),
        ],
      ),
    );
    if (sure == true) _reset(deleteRemote: true);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Column(
          children: [
            _header(context),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                children: [_stepBody(context)],
              ),
            ),
            _footer(),
          ],
        ),
        if (_busy) _overlay(context),
      ],
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Шаг ${_step + 1} из ${_titles.length}', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ),
              if (_sessionId != null || _photos.any((p) => p.file != null))
                TextButton.icon(onPressed: _busy ? null : _cancel, icon: const Icon(Icons.restart_alt, size: 18), label: const Text('Заново')),
            ],
          ),
          Text(_titles[_step], style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ClipRRect(borderRadius: BorderRadius.circular(99), child: LinearProgressIndicator(value: (_step + 1) / _titles.length, minHeight: 6)),
          ),
        ],
      ),
    );
  }

  Widget _footer() {
    final next = _nextAction();
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFE2E6EE)))),
      child: Row(
        children: [
          if (_step > 0)
            Expanded(
              flex: 2,
              child: OutlinedButton(onPressed: _busy ? null : () => setState(() => _step--), child: const Text('Назад')),
            ),
          if (_step > 0) const SizedBox(width: 10),
          Expanded(flex: 3, child: FilledButton(onPressed: _busy ? null : next.$2, child: Text(next.$1))),
        ],
      ),
    );
  }

  (String, VoidCallback?) _nextAction() {
    switch (_step) {
      case 0:
        return ('Найти эталон', _photos.every((p) => p.file != null) ? _toCalibration : null);
      case 1:
        return ('Далее: масштаб', _toScale);
      case 2:
        return ('Далее: выделение', _toMeasure);
      case 3:
        return ('Далее: сравнение', _photos.any((p) => p.measures.isNotEmpty) ? _toReport : null);
      default:
        return ('Сохранить отчёт', _photos.any((p) => p.measures.isNotEmpty) ? _save : null);
    }
  }

  Widget _stepBody(BuildContext context) {
    switch (_step) {
      case 0:
        return _stepPhotos(context);
      case 1:
        return _stepCalibration(context);
      case 2:
        return _stepScale(context);
      case 3:
        return _stepMeasure(context);
      default:
        return _stepReport(context);
    }
  }

  Widget _info(String text, {Color color = brand, IconData icon = Icons.info_outline}) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: color.withAlpha(24), borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }

  Widget _tabs() {
    return SegmentedButton<int>(
      segments: const [
        ButtonSegment<int>(value: 0, label: Text('Образец 1')),
        ButtonSegment<int>(value: 1, label: Text('Образец 2')),
      ],
      selected: <int>{_active},
      onSelectionChanged: (s) => setState(() => _active = s.first),
    );
  }

  Widget _stepPhotos(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _info('На каждом снимке рядом с образцом должен лежать квадрат-эталон 1×1 см в плоскости образца. Нужны два снимка: система приведёт их к одному масштабу.'),
        const SizedBox(height: 14),
        _slot(0, 'Образец 1'),
        const SizedBox(height: 12),
        _slot(1, 'Образец 2'),
        const SizedBox(height: 14),
        TextField(
          controller: _title,
          maxLength: 120,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(labelText: 'Название отчёта (необязательно)', counterText: ''),
        ),
        const SizedBox(height: 4),
        TextButton.icon(
          onPressed: _busy || _photos.every((p) => p.file == null) ? null : _quick,
          icon: const Icon(Icons.auto_awesome),
          label: const Text('Быстро: всё автоматически, без правок'),
        ),
      ],
    );
  }

  Widget _slot(int i, String label) {
    final photo = _photos[i];
    final file = photo.file;
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: Colors.white,
      shape: cardShape,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (file != null)
            AspectRatio(aspectRatio: 4 / 3, child: Image.file(File(file.path), fit: BoxFit.cover, width: double.infinity)),
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
                        onPressed: _busy ? null : () => _pick(i, ImageSource.camera),
                        icon: const Icon(Icons.photo_camera_outlined),
                        label: Text(file == null ? 'Снять' : 'Переснять'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () => _pick(i, ImageSource.gallery),
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

  Widget _stepCalibration(BuildContext context) {
    final p = _cur;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _tabs(),
        const SizedBox(height: 12),
        if (p.warning != null) ...[
          _info(p.warning!, color: p.found ? warnColor : failColor, icon: Icons.warning_amber_rounded),
          const SizedBox(height: 12),
        ] else ...[
          _info('Эталон найден автоматически. Если границы квадрата сдвинуты, перетащите углы.', color: okColor, icon: Icons.check_circle_outline),
          const SizedBox(height: 12),
        ],
        PointsEditor(
          key: ValueKey<String>('cal-$_active-${p.version}-${p.sampleId}'),
          imageUrl: widget.api.imageUri(p.sampleId!).toString(),
          headers: widget.api.imageHeaders,
          imageWidth: p.width,
          imageHeight: p.height,
          points: p.corners,
          fixedCount: true,
          color: p.applied ? okColor : brand,
          onChanged: (pts) => setState(() {
            p.corners = pts;
            p.edited = true;
            p.applied = false;
          }),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _side,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Сторона эталона, мм'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(onPressed: _busy ? null : _research, icon: const Icon(Icons.search), label: const Text('Найти заново')),
            ),
          ],
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _applyCurrent,
          icon: const Icon(Icons.straighten),
          label: Text(p.applied ? 'Масштаб ${fmtNum(p.pxPerMm, 1)} px/мм. Пересчитать' : 'Применить границы и посчитать масштаб'),
        ),
        const SizedBox(height: 8),
        Text(
          'Перетаскивайте углы к углам квадрата. Результат: px/мм = длина стороны в пикселях ÷ ${fmtNum(_sideMm, 1)} мм.',
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 12),
        ),
      ],
    );
  }

  Widget _stepScale(BuildContext context) {
    const ppm = 20;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _info('Оба снимка выпрямлены и приведены к масштабу $ppm px/мм. Теперь квадрат-эталон на них одного размера: ${fmtNum(_sideMm * ppm, 0)} px.', color: okColor, icon: Icons.check_circle_outline),
        const SizedBox(height: 14),
        for (var i = 0; i < _photos.length; i++) ...[
          Section(
            title: 'Образец ${i + 1}',
            trailing: Pill('${fmtNum(_photos[i].pxPerMm, 1)} → $ppm px/мм'),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(
                widget.api.standardizedUri(_photos[i].sampleId!, _photos[i].version, ppm: ppm).toString(),
                headers: widget.api.imageHeaders,
                fit: BoxFit.contain,
                width: double.infinity,
                loadingBuilder: (context, child, progress) => progress == null
                    ? child
                    : const SizedBox(height: 160, child: Center(child: CircularProgressIndicator())),
                errorBuilder: (context, error, stack) => const SizedBox(height: 120, child: Center(child: Text('Не удалось построить снимок'))),
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _stepMeasure(BuildContext context) {
    final p = _cur;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _tabs(),
        const SizedBox(height: 12),
        _info('Касанием ставьте вершины полигона вокруг образца, точки можно двигать, долгое нажатие удаляет вершину. Или нажмите «Авто-контур».'),
        const SizedBox(height: 12),
        PointsEditor(
          key: ValueKey<String>('poly-$_active-${p.version}-${p.sampleId}'),
          imageUrl: widget.api.imageUri(p.sampleId!).toString(),
          headers: widget.api.imageHeaders,
          imageWidth: p.width,
          imageHeight: p.height,
          points: p.draft,
          polygon: true,
          color: const Color(0xFFE0762B),
          onChanged: (pts) => setState(() => p.draft = pts),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _busy || p.draft.isEmpty ? null : () => setState(() => p.draft = p.draft.sublist(0, p.draft.length - 1)),
                icon: const Icon(Icons.undo),
                label: const Text('Отменить'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(onPressed: _busy ? null : _autoOutline, icon: const Icon(Icons.auto_fix_high), label: const Text('Авто-контур')),
            ),
          ],
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          onPressed: _busy || p.draft.length < 3 ? null : _calculate,
          icon: const Icon(Icons.calculate_outlined),
          label: Text(p.draft.length < 3 ? 'Поставьте минимум 3 точки' : 'Рассчитать площадь'),
        ),
        const SizedBox(height: 14),
        Section(
          title: 'Замеры: образец ${_active + 1}',
          child: p.measures.isEmpty
              ? Text('Пока нет. Площадь появится здесь в мм².', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))
              : Column(
                  children: [
                    for (final m in p.measures)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text('${m.label}: ${fmtNum(m.value, 2)} ${m.unit}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        subtitle: Text('±${fmtNum(m.error, 2)} ${m.unit}${m.perimeter == null ? '' : ', периметр ${fmtNum(m.perimeter, 2)} мм'}'),
                        trailing: IconButton(icon: const Icon(Icons.delete_outline), onPressed: _busy ? null : () => _removeMeasure(p, m)),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 6),
        Text(
          'Формула: площадь, мм² = площадь, px² ÷ (px/мм)². Для сравнения выделите образец на обоих снимках.',
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 12),
        ),
      ],
    );
  }

  Widget _stepReport(BuildContext context) {
    final c = _compare;
    final area = c != null && c['area_mm2'] is Map ? (c['area_mm2'] as Map).cast<String, dynamic>() : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Section(
          title: 'Сравнение',
          child: c == null
              ? Text(
                  _compareLoaded ? 'Для сравнения нужны замеры на обоих снимках. Отчёт можно сохранить и с одним образцом.' : 'Сравнение недоступно.',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text((c['verdict'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 8),
                    KeyValue('Масштабы снимков', c['scales_match'] == true ? 'совпадают' : 'различаются, пересчитано в мм'),
                    if (area != null) ...[
                      KeyValue('Площадь образца 1', '${fmtNum((area['a'] as num?)?.toDouble())} мм²'),
                      KeyValue('Площадь образца 2', '${fmtNum((area['b'] as num?)?.toDouble())} мм²'),
                      KeyValue('Разница', fmtPct((area['delta_pct'] as num?)?.toDouble())),
                    ],
                  ],
                ),
        ),
        const SizedBox(height: 12),
        Section(
          title: 'Замеры',
          child: Column(
            children: [
              for (var i = 0; i < _photos.length; i++)
                for (final m in _photos[i].measures) KeyValue('Образец ${i + 1}, ${m.label}', '${fmtNum(m.value, 2)} ${m.unit} (±${fmtNum(m.error, 2)})'),
            ],
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _title,
          maxLength: 120,
          decoration: const InputDecoration(labelText: 'Название отчёта', counterText: ''),
        ),
        const SizedBox(height: 8),
        Text(
          'Отчёт собирается тем же модулем, что и на сайте: PDF, CSV и архив с контрольной суммой. Он сразу появится в истории и на сайте.',
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 12),
        ),
      ],
    );
  }

  Widget _overlay(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black45,
        child: Center(
          child: Card(
            elevation: 0,
            color: Colors.white,
            shape: cardShape,
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: SizedBox(
                width: 240,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 18),
                    Text(_busyText, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
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
