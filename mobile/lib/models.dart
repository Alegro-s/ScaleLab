double? _num(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

int _int(Object? v) => (_num(v) ?? 0).toInt();

class SampleInfo {
  const SampleInfo({
    required this.slot,
    required this.name,
    required this.filename,
    required this.pxPerMm,
    required this.confidence,
    required this.method,
    required this.areaMm2,
    required this.perimeterMm,
    required this.errorMm2,
    required this.regions,
  });

  final int slot;
  final String name;
  final String filename;
  final double? pxPerMm;
  final double? confidence;
  final String method;
  final double? areaMm2;
  final double? perimeterMm;
  final double? errorMm2;
  final int regions;

  factory SampleInfo.fromJson(Map<String, dynamic> j) => SampleInfo(
        slot: _int(j['slot']),
        name: (j['name'] ?? '').toString(),
        filename: (j['filename'] ?? '').toString(),
        pxPerMm: _num(j['px_per_mm']),
        confidence: _num(j['confidence']),
        method: (j['method'] ?? '').toString(),
        areaMm2: _num(j['area_mm2']),
        perimeterMm: _num(j['perimeter_mm']),
        errorMm2: _num(j['error_mm2']),
        regions: _int(j['regions']),
      );
}

class CompareInfo {
  const CompareInfo({
    required this.verdict,
    required this.scalesMatch,
    required this.areaA,
    required this.areaB,
    required this.areaDeltaPct,
    required this.perimeterDeltaPct,
  });

  final String verdict;
  final bool scalesMatch;
  final double? areaA;
  final double? areaB;
  final double? areaDeltaPct;
  final double? perimeterDeltaPct;

  factory CompareInfo.fromJson(Map<String, dynamic> j) {
    final area = j['area'] is Map ? (j['area'] as Map).cast<String, dynamic>() : null;
    final per = j['perimeter'] is Map ? (j['perimeter'] as Map).cast<String, dynamic>() : null;
    return CompareInfo(
      verdict: (j['verdict'] ?? '').toString(),
      scalesMatch: j['scales_match'] == true,
      areaA: _num(area?['a']),
      areaB: _num(area?['b']),
      areaDeltaPct: _num(area?['delta_pct']),
      perimeterDeltaPct: _num(per?['delta_pct']),
    );
  }
}

enum CheckStatus { ok, warn, fail }

class CheckInfo {
  const CheckInfo({required this.key, required this.title, required this.status, required this.detail});

  final String key;
  final String title;
  final CheckStatus status;
  final String detail;

  factory CheckInfo.fromJson(Map<String, dynamic> j) => CheckInfo(
        key: (j['key'] ?? '').toString(),
        title: (j['title'] ?? '').toString(),
        status: switch (j['status']) {
          'ok' => CheckStatus.ok,
          'warn' => CheckStatus.warn,
          _ => CheckStatus.fail,
        },
        detail: (j['detail'] ?? '').toString(),
      );
}

class ReportSummary {
  const ReportSummary({
    required this.id,
    required this.number,
    required this.title,
    required this.createdAt,
    required this.version,
    required this.sha256,
    required this.samples,
    required this.compare,
    required this.conclusions,
    required this.checks,
  });

  final String id;
  final int number;
  final String title;
  final DateTime createdAt;
  final int version;
  final String sha256;
  final List<SampleInfo> samples;
  final CompareInfo? compare;
  final List<String> conclusions;
  final List<CheckInfo> checks;

  int get problems => checks.where((c) => c.status != CheckStatus.ok).length;

  factory ReportSummary.fromJson(Map<String, dynamic> j) => ReportSummary(
        id: j['id'].toString(),
        number: _int(j['number']),
        title: (j['title'] ?? '').toString(),
        createdAt: DateTime.tryParse((j['created_at'] ?? '').toString()) ?? DateTime.now(),
        version: _int(j['version']),
        sha256: (j['sha256'] ?? '').toString(),
        samples: ((j['samples'] ?? []) as List).map((e) => SampleInfo.fromJson((e as Map).cast<String, dynamic>())).toList(),
        compare: j['compare'] is Map ? CompareInfo.fromJson((j['compare'] as Map).cast<String, dynamic>()) : null,
        conclusions: ((j['conclusions'] ?? []) as List).map((e) => e.toString()).toList(),
        checks: ((j['checks'] ?? []) as List).map((e) => CheckInfo.fromJson((e as Map).cast<String, dynamic>())).toList(),
      );
}

class HistoryItem {
  const HistoryItem({
    required this.id,
    required this.number,
    required this.title,
    required this.createdAt,
    required this.areas,
    required this.verdict,
    required this.problems,
  });

  final String id;
  final int number;
  final String title;
  final DateTime createdAt;
  final List<double?> areas;
  final String? verdict;
  final int problems;

  factory HistoryItem.fromJson(Map<String, dynamic> j) => HistoryItem(
        id: j['id'].toString(),
        number: _int(j['number']),
        title: (j['title'] ?? '').toString(),
        createdAt: DateTime.tryParse((j['created_at'] ?? '').toString()) ?? DateTime.now(),
        areas: ((j['samples'] ?? []) as List).map((e) => _num((e as Map)['area_mm2'])).toList(),
        verdict: j['verdict']?.toString(),
        problems: _int(j['problems']),
      );
}
