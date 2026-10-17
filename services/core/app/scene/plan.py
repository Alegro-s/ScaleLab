from __future__ import annotations
import numpy as np
from ..calibration import find_reference_square
from ..geometry import area_mm2, shoelace_area_px
from .marker import RELIABLE_CONFIDENCE, find_marker
from .objects import locate_object, mask_polygons

MARKER_SIDE_MM = 50.0
TILT_NOT_NEEDED = 0.03
UNSURE_REFERENCE = 0.6
SIDE_MM_TOLERANCE = 1e-6
UNSURE_OBJECT = 0.4
MIN_REFERENCE_FRAME_SHARE = 0.01
PX_PER_MM_RANGE = (2.0, 120.0)

def find_reference(img: np.ndarray, side_mm: float, max_candidates: int = 5, marker_side_mm: float = MARKER_SIDE_MM) -> dict:
    candidates = []
    for candidate in find_reference_square(img, side_mm, max_candidates).get("candidates", []):
        candidates.append({**candidate, "kind": "checker", "side_mm": side_mm})
    for candidate in find_marker(img, marker_side_mm, max_candidates):
        candidates.append({**candidate, "side_mm": marker_side_mm})
    for candidate in candidates:
        candidate["reliable"] = bool(candidate["confidence"] >= RELIABLE_CONFIDENCE)
    candidates.sort(key=lambda c: (c["reliable"], c["confidence"]), reverse=True)
    return {"found": bool(candidates), "candidates": candidates[:max_candidates]}

def _reference_plan(marker: dict | None, frame_area: float, requested_side_mm: float) -> tuple[dict | None, dict, list[str]]:
    if marker is None:
        return None, {"mode": "unknown", "tilt_pct": None}, ["Эталон не найден автоматически: укажите четыре угла вручную."]
    warnings: list[str] = []
    needs_confirmation = marker.get("reliable") is False
    reference = {"kind": marker.get("kind", "checker"), "px_per_mm": marker["px_per_mm"], "confidence": marker["confidence"],
                 "squareness": marker["squareness"], "side_px": marker["side_px"], "needs_confirmation": needs_confirmation}
    declared_side = marker.get("side_mm")
    if declared_side is not None and abs(float(declared_side) - requested_side_mm) > SIDE_MM_TOLERANCE:
        warnings.append(f"Размер эталона у найденного кандидата ({declared_side:g} мм) отличается от заданного ({requested_side_mm:g} мм): масштаб посчитан по размеру кандидата.")
    tilt = 1.0 - marker["squareness"]
    tilt_pct = round(tilt * 100, 1)
    if tilt < TILT_NOT_NEEDED:
        perspective = {"mode": "not_needed", "tilt_pct": tilt_pct}
    else:
        perspective = {"mode": "scale_by_area", "tilt_pct": tilt_pct}
        warnings.append("Эталон снят под углом: масштаб берётся по площади эталона. Выпрямление снимка по эталону верно только для объекта в плоскости эталона.")
    if needs_confirmation:
        warnings.append("Эталон найден ненадёжно и не сохраняется автоматически: подтвердите или поправьте углы вручную.")
    elif marker["confidence"] < UNSURE_REFERENCE:
        warnings.append("Эталон найден неуверенно: проверьте углы вручную.")
    if marker["side_px"] ** 2 / frame_area < MIN_REFERENCE_FRAME_SHARE:
        warnings.append("Эталон занимает малую часть кадра: погрешность масштаба выше.")
    if not PX_PER_MM_RANGE[0] <= marker["px_per_mm"] <= PX_PER_MM_RANGE[1]:
        warnings.append("Масштаб выглядит неправдоподобно: проверьте размер выбранного эталона.")
    return reference, perspective, warnings

def _object_plan(obj: dict, marker: dict | None, warnings: list[str]) -> dict | None:
    if not obj["found"]:
        warnings.append("Объект по цвету не найден: обведите его вручную.")
        return None
    polygons = mask_polygons(obj["mask"])
    description = {"bbox": obj["bbox"], "centroid": obj["centroid"], "area_frac": obj["area_frac"],
                   "color_rgb": obj["color_rgb"], "confidence": obj["confidence"], "regions": polygons}
    if marker is not None and polygons:
        description["area_mm2"] = round(sum(area_mm2(shoelace_area_px(p), marker["px_per_mm"]) for p in polygons), 2)
    if obj["confidence"] < UNSURE_OBJECT:
        warnings.append("Объект выделен по цвету неуверенно: проверьте контур.")
    return description

def analyze(img: np.ndarray, side_mm: float, marker: dict | None = None) -> dict:
    height, width = img.shape[:2]
    reference, perspective, warnings = _reference_plan(marker, float(width * height), side_mm)
    obj = locate_object(img, marker["corners"] if marker else None)
    object_description = _object_plan(obj, marker, warnings)
    return {"reference": reference, "perspective": perspective,
            "segmentation": {"method": "color_grabcut", "found": bool(obj["found"])},
            "warnings": warnings, "object": object_description}
