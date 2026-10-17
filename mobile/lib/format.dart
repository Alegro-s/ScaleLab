String fmtNum(double? v, [int digits = 2]) {
  if (v == null) return '—';
  return v.toStringAsFixed(digits).replaceAll('.', ',');
}

String fmtPct(double? v) {
  if (v == null) return '—';
  final sign = v > 0 ? '+' : '';
  return '$sign${fmtNum(v, 1)} %';
}

String fmtDate(DateTime d) {
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(l.day)}.${two(l.month)}.${l.year} ${two(l.hour)}:${two(l.minute)}';
}
