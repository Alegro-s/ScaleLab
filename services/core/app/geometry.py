from __future__ import annotations
import math
from typing import Sequence

Point = Sequence[float]

def shoelace_area_px(v: Sequence[Point]) -> float:
    n = len(v)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = v[i]
        x2, y2 = v[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0

def perimeter_px(v: Sequence[Point], closed: bool = True) -> float:
    n = len(v)
    if n < 2:
        return 0.0
    end = n if closed else n - 1
    return sum(math.dist(v[i], v[(i + 1) % n]) for i in range(end))

def px_per_mm(side_px: float, side_mm: float) -> float:
    if side_px <= 0 or side_mm <= 0:
        raise ValueError("Стороны эталона должны быть положительными")
    return side_px / side_mm

def corners_side_px(corners: Sequence[Point]) -> float:
    if len(corners) != 4:
        raise ValueError("Нужно ровно 4 угла эталона")
    return perimeter_px(corners) / 4.0

def scale_error_rel(side_px: float, corner_err_px: float = 0.5) -> float:
    return corner_err_px / side_px if side_px > 0 else 1.0

def area_mm2(area_px: float, k: float) -> float:
    return area_px / (k * k)

def area_error_mm2(area_mm2_value: float, rel_k: float) -> float:
    return 2.0 * area_mm2_value * rel_k

def angle_deg(a: Point, b: Point, c: Point) -> float:
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 == 0 or n2 == 0:
        return 0.0
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))

def measure_polygon(vertices: Sequence[Point], k: float, rel_k: float = 0.0) -> dict:
    a_px = shoelace_area_px(vertices)
    a = area_mm2(a_px, k)
    return {
        "kind": "polygon",
        "area_px": a_px,
        "value": a,
        "unit": "мм²",
        "perimeter_mm": perimeter_px(vertices) / k,
        "error": area_error_mm2(a, rel_k),
    }

def measure_line(vertices: Sequence[Point], k: float, rel_k: float = 0.0) -> dict:
    if len(vertices) < 2:
        raise ValueError("Для линии нужно минимум 2 точки")
    length = perimeter_px(vertices, closed=False) / k
    return {"kind": "line", "value": length, "unit": "мм", "error": length * rel_k}

def measure_angle(vertices: Sequence[Point]) -> dict:
    if len(vertices) != 3:
        raise ValueError("Для угла нужно ровно 3 точки (вершина — вторая)")
    return {"kind": "angle", "value": angle_deg(*vertices), "unit": "°", "error": 0.5}

def measure_circle(vertices: Sequence[Point], k: float, rel_k: float = 0.0) -> dict:
    if len(vertices) != 2:
        raise ValueError("Для окружности: центр и точка на ней")
    d = 2 * math.dist(vertices[0], vertices[1]) / k
    r_px = math.dist(vertices[0], vertices[1])
    return {
        "kind": "circle",
        "value": d,
        "unit": "мм",
        "area_px": math.pi * r_px * r_px,
        "perimeter_mm": math.pi * d,
        "error": d * rel_k,
    }
