import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import 'theme.dart';

class PointsEditor extends StatefulWidget {
  const PointsEditor({
    super.key,
    required this.imageUrl,
    required this.headers,
    required this.imageWidth,
    required this.imageHeight,
    required this.points,
    required this.onChanged,
    this.polygon = false,
    this.fixedCount = false,
    this.color = brand,
  });

  final String imageUrl;
  final Map<String, String> headers;
  final double imageWidth;
  final double imageHeight;
  final List<Offset> points;
  final ValueChanged<List<Offset>> onChanged;
  final bool polygon;
  final bool fixedCount;
  final Color color;

  @override
  State<PointsEditor> createState() => _PointsEditorState();
}

class _PointsEditorState extends State<PointsEditor> {
  int? _drag;

  static const double _hit = 40;

  @override
  Widget build(BuildContext context) {
    final ratio = widget.imageWidth <= 0 || widget.imageHeight <= 0 ? 4 / 3 : widget.imageWidth / widget.imageHeight;
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: AspectRatio(
        aspectRatio: ratio,
        child: LayoutBuilder(
          builder: (context, c) {
            final k = widget.imageWidth <= 0 ? 1.0 : c.maxWidth / widget.imageWidth;
            Offset toScreen(Offset p) => Offset(p.dx * k, p.dy * k);
            Offset toImage(Offset s) => Offset(
                  (s.dx / k).clamp(0.0, widget.imageWidth).toDouble(),
                  (s.dy / k).clamp(0.0, widget.imageHeight).toDouble(),
                );
            int? nearest(Offset s) {
              int? best;
              var bestD = _hit;
              for (var i = 0; i < widget.points.length; i++) {
                final d = (toScreen(widget.points[i]) - s).distance;
                if (d < bestD) {
                  bestD = d;
                  best = i;
                }
              }
              return best;
            }

            return GestureDetector(
              behavior: HitTestBehavior.opaque,
              dragStartBehavior: DragStartBehavior.down,
              onTapUp: (d) {
                if (widget.fixedCount || nearest(d.localPosition) != null) return;
                widget.onChanged(<Offset>[...widget.points, toImage(d.localPosition)]);
              },
              onPanStart: (d) => _drag = nearest(d.localPosition),
              onPanUpdate: (d) {
                final i = _drag;
                if (i == null || i >= widget.points.length) return;
                final next = <Offset>[...widget.points];
                next[i] = toImage(d.localPosition);
                widget.onChanged(next);
              },
              onPanEnd: (_) => _drag = null,
              onPanCancel: () => _drag = null,
              onLongPressStart: (d) {
                if (widget.fixedCount) return;
                final i = nearest(d.localPosition);
                if (i == null) return;
                final next = <Offset>[...widget.points]..removeAt(i);
                widget.onChanged(next);
              },
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.network(
                    widget.imageUrl,
                    headers: widget.headers,
                    fit: BoxFit.fill,
                    loadingBuilder: (context, child, progress) => progress == null
                        ? child
                        : const ColoredBox(color: Color(0xFFE8ECF3), child: Center(child: CircularProgressIndicator())),
                    errorBuilder: (context, error, stack) => const ColoredBox(
                      color: Color(0xFFE8ECF3),
                      child: Center(child: Icon(Icons.broken_image_outlined, size: 40)),
                    ),
                  ),
                  CustomPaint(painter: _PointsPainter(widget.points.map(toScreen).toList(), widget.polygon || widget.fixedCount, widget.color, widget.fixedCount)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _PointsPainter extends CustomPainter {
  const _PointsPainter(this.pts, this.closed, this.color, this.big);

  final List<Offset> pts;
  final bool closed;
  final Color color;
  final bool big;

  @override
  void paint(Canvas canvas, Size size) {
    if (pts.isEmpty) return;
    final path = Path()..moveTo(pts.first.dx, pts.first.dy);
    for (final p in pts.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    if (closed && pts.length >= 3) {
      path.close();
      canvas.drawPath(path, Paint()..color = color.withAlpha(48)..style = PaintingStyle.fill);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = 2.5
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke,
    );
    if (pts.length > 80) return;
    final r = big ? 13.0 : 9.0;
    for (final p in pts) {
      canvas.drawCircle(p, r, Paint()..color = Colors.white);
      canvas.drawCircle(
        p,
        r,
        Paint()
          ..color = color
          ..strokeWidth = 3
          ..style = PaintingStyle.stroke,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _PointsPainter old) => true;
}
