from __future__ import annotations
import csv
import hashlib
import io
import json
import os
from datetime import datetime
from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as RLImage, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_BUNDLED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
FONT_CANDIDATES = [
    (os.path.join(_BUNDLED, "DejaVuSans.ttf"), os.path.join(_BUNDLED, "DejaVuSans-Bold.ttf")),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Regular.ttf", "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]
_font = None
MAX_VERTEX_DOTS = 60

def _register_fonts() -> tuple[str, str]:
    global _font
    if _font:
        return _font
    env = os.environ.get("REPORT_FONT")
    cands = ([(env, env)] if env else []) + FONT_CANDIDATES
    for reg, bold in cands:
        if reg and os.path.exists(reg):
            pdfmetrics.registerFont(TTFont("SL", reg))
            pdfmetrics.registerFont(TTFont("SL-B", bold if os.path.exists(bold) else reg))
            _font = ("SL", "SL-B")
            return _font
    raise RuntimeError("Не найден TTF-шрифт с кириллицей (установите fonts-roboto или fonts-dejavu-core)")

def payload_sha256(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()

def fmt(v, d=2):
    return "—" if v is None else f"{v:.{d}f}".replace(".", ",")

def overlay_png(image_path: str, measurements: list[dict], max_side: int = 1600) -> bytes:
    im = Image.open(image_path).convert("RGB")
    scale = min(1.0, max_side / max(im.size))
    if scale < 1:
        im = im.resize((int(im.width * scale), int(im.height * scale)))
    dr = ImageDraw.Draw(im, "RGBA")
    for m in measurements:
        pts = [(x * scale, y * scale) for x, y in m.get("vertices", [])]
        if len(pts) < 2:
            continue
        kind = m.get("kind")
        if kind in ("polygon", "mask") and len(pts) >= 3:
            dr.polygon(pts, fill=(121, 186, 242, 60), outline=(153, 197, 222, 255))
        elif kind == "circle":
            r = ((pts[0][0] - pts[1][0]) ** 2 + (pts[0][1] - pts[1][1]) ** 2) ** .5
            dr.ellipse([pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r], outline=(153, 197, 222, 255), width=3)
        else:
            dr.line(pts, fill=(153, 197, 222, 255), width=3)
        if kind == "mask" or len(pts) > MAX_VERTEX_DOTS:
            continue
        for p in pts:
            dr.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], fill=(255, 255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()

def to_csv(payload: dict) -> bytes:
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["Образец", "Метка", "Тип", "Значение", "Ед.", "Периметр, мм", "Погрешность", "px/мм"])
    for s in payload.get("samples", []):
        for m in s.get("measurements", []):
            w.writerow([s.get("name"), m.get("label"), m.get("kind"), fmt(m.get("value"), 3), m.get("unit"),
                        fmt(m.get("perimeter_mm"), 3), fmt(m.get("error"), 3), fmt(s.get("px_per_mm"), 3)])
    return ("﻿" + out.getvalue()).encode("utf-8")

def to_pdf(payload: dict) -> bytes:
    f, fb = _register_fonts()
    sec = payload.get("sections", {})
    st = lambda n, **k: ParagraphStyle(n, fontName=k.pop("fontName", f), **k)
    H1 = st("h1", fontSize=20, leading=24, fontName=fb, spaceAfter=6)
    H2 = st("h2", fontSize=13, leading=16, fontName=fb, spaceBefore=10, spaceAfter=4)
    B = st("b", fontSize=10, leading=14)
    S = st("s", fontSize=8, leading=10, textColor=colors.grey)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=payload.get("title", "Отчёт"))
    el = []
    if sec.get("title", True):
        el += [Paragraph(f"ПРОТОКОЛ № {payload.get('session', {}).get('number', '')}, МасштабЛаб", S),
               Paragraph(payload.get("title", "Измерение площади в едином масштабе"), H1),
               Paragraph(f"Дата: {payload.get('generated_at', datetime.now().strftime('%d.%m.%Y'))}, Оператор: {payload.get('operator', '—')}, Версия: v{payload.get('version', 1)}", B)]
    samples = payload.get("samples", [])
    if sec.get("images", True):
        row = []
        for s in samples:
            p = s.get("image_path")
            if p and os.path.exists(p):
                im = RLImage(io.BytesIO(overlay_png(p, s.get("measurements", []), 900)), width=80 * mm, height=60 * mm, kind="proportional")
                row.append([im, Paragraph(f"{s.get('name')}", S)])
        if row:
            t = Table([[r[0] for r in row], [r[1] for r in row]], colWidths=[85 * mm] * len(row))
            el += [Spacer(1, 8), t]
    if sec.get("calibration", True):
        el.append(Paragraph("Калибровка", H2))
        rows = [["Образец", "Эталон", "px/мм", "Уверенность"]]
        for s in samples:
            rows.append([s.get("name"), f"{fmt(s.get('side_mm'), 1)} мм", fmt(s.get("px_per_mm"), 2), f"{round((s.get('confidence') or 0) * 100)} %"])
        el.append(_table(rows, f, fb))
    if sec.get("table", True):
        el.append(Paragraph("Таблица измерений", H2))
        rows = [["Образец", "Метка", "Значение", "Периметр, мм", "Погрешность"]]
        for s in samples:
            for m in s.get("measurements", []):
                rows.append([s.get("name"), m.get("label"), f"{fmt(m.get('value'))} {m.get('unit')}", fmt(m.get("perimeter_mm")), f"±{fmt(m.get('error'), 2)}"])
        el.append(_table(rows, f, fb))
    cmp_ = payload.get("compare")
    if cmp_ and sec.get("table", True):
        el += [Paragraph("Сравнение", H2), Paragraph(cmp_.get("verdict", ""), B)]
    if sec.get("formulas", True):
        el += [Paragraph("Формулы расчёта", H2),
               Paragraph("K = сторона эталона, px / сторона эталона, мм", B),
               Paragraph("S, мм² = S, px / K²;  S, px = ½ |Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|", B),
               Paragraph("P, мм = Σ |vᵢ vᵢ₊₁| / K", B)]
    if sec.get("conclusions", True) and payload.get("conclusions"):
        el.append(Paragraph("Выводы", H2))
        el += [Paragraph("• " + c, B) for c in payload["conclusions"]]
    if sec.get("checksum", True):
        el += [Spacer(1, 10), Paragraph(f"Контрольная сумма: SHA-256 {payload.get('sha256', '')}", S)]
    if sec.get("signature", False):
        el += [Spacer(1, 18), Paragraph("Подпись оператора: ____________________", B)]
    doc.build(el)
    return buf.getvalue()

def _table(rows, f, fb):
    t = Table(rows, repeatRows=1)
    t.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), f), ("FONTNAME", (0, 0), (-1, 0), fb), ("FONTSIZE", (0, 0), (-1, -1), 9),
                           ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E4E8EE")), ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#9AA0AA")),
                           ("ALIGN", (2, 1), (-1, -1), "RIGHT")]))
    return t
