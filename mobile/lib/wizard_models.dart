import 'dart:ui';

import 'package:image_picker/image_picker.dart';

double _d(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0;
  return 0;
}

List<Offset> parsePoints(Object? raw) {
  if (raw is! List) return <Offset>[];
  return raw.map((p) {
    final l = p as List;
    return Offset(_d(l[0]), _d(l[1]));
  }).toList();
}

List<List<double>> pointsJson(List<Offset> pts) => pts.map((p) => <double>[p.dx, p.dy]).toList();

class Candidate {
  const Candidate({required this.corners, required this.pxPerMm, required this.confidence, required this.kind, required this.sideMm});

  final List<Offset> corners;
  final double pxPerMm;
  final double confidence;
  final String? kind;
  final double sideMm;

  factory Candidate.fromJson(Map<String, dynamic> j) => Candidate(
        corners: parsePoints(j['corners']),
        pxPerMm: _d(j['px_per_mm']),
        confidence: _d(j['confidence']),
        kind: j['kind']?.toString(),
        sideMm: j['side_mm'] == null ? 10 : _d(j['side_mm']),
      );
}

class Analysis {
  const Analysis({required this.found, required this.candidates, required this.width, required this.height, required this.warnings});

  final bool found;
  final List<Candidate> candidates;
  final double width;
  final double height;
  final List<String> warnings;

  factory Analysis.fromJson(Map<String, dynamic> j) {
    final image = j['image'] is Map ? (j['image'] as Map).cast<String, dynamic>() : <String, dynamic>{};
    return Analysis(
      found: j['found'] == true,
      candidates: ((j['candidates'] ?? []) as List).map((e) => Candidate.fromJson((e as Map).cast<String, dynamic>())).toList(),
      width: _d(image['width']),
      height: _d(image['height']),
      warnings: ((j['warnings'] ?? []) as List).map((e) => e.toString()).toList(),
    );
  }
}

class Measure {
  const Measure({required this.id, required this.label, required this.kind, required this.value, required this.unit, required this.perimeter, required this.error});

  final String id;
  final String label;
  final String kind;
  final double value;
  final String unit;
  final double? perimeter;
  final double error;

  factory Measure.fromJson(Map<String, dynamic> j) => Measure(
        id: j['id'].toString(),
        label: (j['label'] ?? '').toString(),
        kind: (j['kind'] ?? '').toString(),
        value: _d(j['value']),
        unit: (j['unit'] ?? 'мм²').toString(),
        perimeter: j['perimeter_mm'] == null ? null : _d(j['perimeter_mm']),
        error: _d(j['error']),
      );
}

class Photo {
  XFile? file;
  String? sampleId;
  double width = 0;
  double height = 0;
  bool found = false;
  bool edited = false;
  bool applied = false;
  double confidence = 0;
  double pxPerMm = 0;
  double sideMm = 10;
  String? kind;
  String? warning;
  int version = 0;
  List<Offset> corners = <Offset>[];
  List<Offset> draft = <Offset>[];
  List<Measure> measures = <Measure>[];

  bool get uploaded => sampleId != null;

  void resetRemote() {
    sampleId = null;
    width = 0;
    height = 0;
    found = false;
    edited = false;
    applied = false;
    confidence = 0;
    pxPerMm = 0;
    warning = null;
    corners = <Offset>[];
    draft = <Offset>[];
    measures = <Measure>[];
    version++;
  }

  void defaultCorners() {
    final w = width;
    final h = height;
    final s = (w < h ? w : h) * 0.2;
    final cx = w / 2;
    final cy = h / 2;
    corners = <Offset>[Offset(cx - s / 2, cy - s / 2), Offset(cx + s / 2, cy - s / 2), Offset(cx + s / 2, cy + s / 2), Offset(cx - s / 2, cy + s / 2)];
  }
}
