import 'package:flutter_test/flutter_test.dart';
import 'package:masshtablab_mobile/format.dart';
import 'package:masshtablab_mobile/models.dart';

void main() {
  test('отчёт разбирается из ответа сервера', () {
    final r = ReportSummary.fromJson({
      'id': 'a1',
      'number': 7,
      'title': 'Тест',
      'created_at': '2026-10-17T09:30:00.000Z',
      'version': 1,
      'sha256': 'abc',
      'samples': [
        {'slot': 1, 'name': 'Фото 1', 'filename': 'a.jpg', 'px_per_mm': '12.1', 'confidence': 0.9, 'method': 'auto', 'area_mm2': 100.5, 'perimeter_mm': 40, 'error_mm2': 1.2, 'regions': 3},
      ],
      'compare': {
        'verdict': 'Фото 2 больше на 5,0 %',
        'scales_match': true,
        'area': {'a': 100.0, 'b': 105.0, 'delta': 5.0, 'delta_pct': 5.0},
        'perimeter': null,
      },
      'conclusions': ['ок'],
      'checks': [
        {'key': 'k', 'title': 'Эталон', 'status': 'ok', 'detail': ''},
        {'key': 'h', 'title': 'Сумма', 'status': 'warn', 'detail': ''},
      ],
    });
    expect(r.samples.single.pxPerMm, 12.1);
    expect(r.compare?.areaDeltaPct, 5.0);
    expect(r.problems, 1);
  });

  test('числа форматируются с запятой', () {
    expect(fmtNum(12.345), '12,35');
    expect(fmtNum(null), '—');
    expect(fmtPct(5), '+5,0 %');
  });
}
