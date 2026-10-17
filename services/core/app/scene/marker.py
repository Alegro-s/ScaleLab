from __future__ import annotations
import cv2
import numpy as np
from ..calibration import order_corners
from ..geometry import corners_side_px, px_per_mm
from .quad import quad_metrics, refine_quad, outward_normal, sample_side, side_coverage, side_lengths

LSD_MAX_SIDE = 640.0
MAX_LINES = 45
MAX_CANDIDATES_REFINED = 80
PARALLEL_TOL = np.radians(10)
MERGE_ANGLE_TOL = np.radians(4)
MERGE_OFFSET_PX = 4.0
PERPENDICULAR_TOL_FULL = np.radians(25)
PERPENDICULAR_TOL_COMPLETED = np.radians(12)
RELIABLE_CONFIDENCE = 0.45

def _line_normal(theta: float) -> tuple[float, float]:
    return -np.sin(theta), np.cos(theta)

def _merge_lines(segments: np.ndarray, min_len: float) -> list[dict]:
    items = []
    for x1, y1, x2, y2 in segments.reshape(-1, 4):
        length = float(np.hypot(x2 - x1, y2 - y1))
        if length < min_len * 0.35:
            continue
        theta = float(np.arctan2(y2 - y1, x2 - x1)) % np.pi
        nx, ny = _line_normal(theta)
        items.append((theta, float(nx * x1 + ny * y1), length))
    items.sort(key=lambda item: item[0])
    lines: list[dict] = []
    for theta, rho, length in items:
        for line in lines:
            dtheta = abs(theta - line["th"])
            dtheta = min(dtheta, np.pi - dtheta)
            same_direct = dtheta < MERGE_ANGLE_TOL and abs(rho - line["rho"]) < MERGE_OFFSET_PX
            same_wrapped = (np.pi - theta + line["th"] < MERGE_ANGLE_TOL) and abs(rho + line["rho"]) < MERGE_OFFSET_PX
            if same_direct or same_wrapped:
                total = line["len"] + length
                line["th"] = (line["th"] * line["len"] + theta * length) / total
                line["rho"] = (line["rho"] * line["len"] + rho * length) / total
                line["len"] = total
                break
        else:
            lines.append({"th": theta, "rho": rho, "len": length})
    lines = [line for line in lines if line["len"] >= min_len]
    lines.sort(key=lambda line: line["len"], reverse=True)
    return lines[:MAX_LINES]

def _intersect(a: dict, b: dict) -> tuple[float, float] | None:
    n1x, n1y = _line_normal(a["th"])
    n2x, n2y = _line_normal(b["th"])
    det = n1x * n2y - n1y * n2x
    if abs(det) < 0.2:
        return None
    return (a["rho"] * n2y - n1y * b["rho"]) / det, (n1x * b["rho"] - a["rho"] * n2x) / det

def _angle_between(a: dict, b: dict) -> float:
    angle = abs(a["th"] - b["th"])
    return min(angle, np.pi - angle)

def _parallel_pairs(lines: list[dict], side_min: float, side_max: float) -> list[tuple[int, int, float]]:
    pairs = []
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            a, b = lines[i], lines[j]
            if _angle_between(a, b) > PARALLEL_TOL:
                continue
            same_side = np.dot(_line_normal(a["th"]), _line_normal(b["th"])) > 0
            distance = abs(a["rho"] - (b["rho"] if same_side else -b["rho"]))
            if side_min <= distance <= side_max:
                pairs.append((i, j, distance))
    return pairs

def _quad_in_frame(points: list, width: int, height: int) -> np.ndarray | None:
    if any(p is None for p in points):
        return None
    quad = np.array(points, np.float32)
    if quad.min() < -2 or quad[:, 0].max() > width + 2 or quad[:, 1].max() > height + 2:
        return None
    return order_corners(quad)

def _candidates_from_four_lines(lines, pairs, drawn, width, height) -> list[tuple[float, np.ndarray]]:
    found = []
    for first in range(len(pairs)):
        for second in range(first + 1, len(pairs)):
            (a1, a2, d1), (b1, b2, d2) = pairs[first], pairs[second]
            if len({a1, a2, b1, b2}) < 4 or min(d1, d2) / max(d1, d2) < 0.55:
                continue
            if abs(_angle_between(lines[a1], lines[b1]) - np.pi / 2) > PERPENDICULAR_TOL_FULL:
                continue
            corners = [_intersect(lines[x], lines[y]) for x, y in ((a1, b1), (a1, b2), (a2, b2), (a2, b1))]
            quad = _quad_in_frame(corners, width, height)
            if quad is None:
                continue
            sides = side_lengths(quad)
            if sides.min() < 0.6 * sides.max():
                continue
            coverage = side_coverage(drawn, quad)
            weakest, mean = min(coverage), float(np.mean(coverage))
            if weakest < 0.4 or mean < 0.65:
                continue
            found.append((0.5 * weakest + 0.5 * mean + 0.3 * float(sides.min() / sides.max()), quad))
    return found

def _candidates_with_completed_side(lines, pairs, drawn, width, height) -> list[tuple[float, np.ndarray]]:
    found = []
    for a1, a2, distance in pairs:
        first, second = lines[a1], lines[a2]
        for index, base in enumerate(lines):
            if index in (a1, a2):
                continue
            if abs(_angle_between(first, base) - np.pi / 2) > PERPENDICULAR_TOL_COMPLETED:
                continue
            for sign in (1.0, -1.0):
                virtual = {"th": base["th"], "rho": base["rho"] + sign * distance, "len": base["len"]}
                corners = [_intersect(first, base), _intersect(first, virtual), _intersect(second, virtual), _intersect(second, base)]
                quad = _quad_in_frame(corners, width, height)
                if quad is None:
                    continue
                sides = side_lengths(quad)
                if sides.min() < 0.8 * sides.max():
                    continue
                coverage = sorted(side_coverage(drawn, quad))
                if coverage[1] < 0.45 or float(np.mean(coverage[1:])) < 0.6:
                    continue
                found.append((0.5 * coverage[1] + 0.5 * float(np.mean(coverage)) - 0.1, quad))
    return found

def _dark_border_share(gray: np.ndarray, mask: np.ndarray, threshold: float) -> tuple[float, np.ndarray]:
    width = max(5, int(0.1 * np.sqrt(mask.sum() / 255.0))) | 1
    band = cv2.erode(mask, np.ones((3, 3), np.uint8)) & ~cv2.erode(mask, np.ones((width, width), np.uint8))
    values = gray[band > 0]
    share = float((values < threshold).mean()) if values.size else 0.0
    return share, band

def _ring_score(gray: np.ndarray, quad: np.ndarray, base_level: float) -> float:
    q = order_corners(quad).astype(np.float64)
    center = q.mean(axis=0)
    size = float(np.sqrt(cv2.contourArea(q.astype(np.float32))))
    per_side = []
    for i in range(4):
        normal = outward_normal(q[i], q[(i + 1) % 4], center)
        levels = []
        for offset in (0.03 * size, 0.055 * size):
            pts = sample_side(q, i, 0.2, 0.8, 15) + offset * normal
            xi = np.clip(np.round(pts[:, 0]).astype(int), 0, gray.shape[1] - 1)
            yi = np.clip(np.round(pts[:, 1]).astype(int), 0, gray.shape[0] - 1)
            levels.append(float(gray[yi, xi].mean()))
        per_side.append(min(1.0, max(0.0, (float(np.mean(levels)) - base_level) / 60.0)))
    return 0.5 * float(np.mean(per_side)) + 0.5 * float(sorted(per_side)[1])

def _marker_pattern(gray: np.ndarray, quad: np.ndarray) -> tuple[float, float]:
    mask = np.zeros(gray.shape, np.uint8)
    cv2.fillConvexPoly(mask, quad.astype(np.int32), 255)
    inner = cv2.erode(mask, np.ones((9, 9), np.uint8))
    inner_values = gray[inner > 0]
    if inner_values.size < 50:
        return 0.0, 0.0
    low, high = np.percentile(inner_values, 8), np.percentile(inner_values, 97)
    midpoint = (low + high) / 2
    light_share = float((inner_values > midpoint).mean())
    contrast = min(1.0, max(0.0, (high - low) / 130.0))
    share_factor = 1.0 if 0.03 <= light_share <= 0.65 else 0.3
    dark_border, band = _dark_border_share(gray, mask, midpoint)
    pattern = contrast * share_factor * min(1.0, dark_border / 0.85) ** 3
    band_values = gray[band > 0]
    base_level = float(np.median(band_values)) if band_values.size else float(inner_values.mean())
    return pattern, _ring_score(gray, quad, base_level)

PATTERN_MARGIN = 0.20
LAYOUT_TOLERANCE = 0.08
RECENTER_FROM_DEVIATION = 0.025
RECENTER_PASSES = 3

def _pattern_box(gray: np.ndarray, quad: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    size = 100
    target = np.float32([[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]])
    homography = cv2.getPerspectiveTransform(order_corners(quad).astype(np.float32), target)
    warped = cv2.warpPerspective(gray, homography, (size, size))
    centre = warped[8:size - 8, 8:size - 8]
    threshold = (np.percentile(centre, 5) + np.percentile(centre, 97)) / 2
    bright = (warped > threshold).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=4)
    boxes = []
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        touches_edge = x == 0 or y == 0 or x + w >= size or y + h >= size
        if area >= 0.01 * size * size and not touches_edge:
            boxes.append((x, y, x + w, y + h))
    if not boxes:
        return None
    box = np.array([min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)], np.float64)
    return box / size, np.linalg.inv(homography)

def _layout_deviation(box: np.ndarray) -> float:
    margins = np.array([box[0], box[1], 1 - box[2], 1 - box[3]])
    return float(np.abs(margins - PATTERN_MARGIN).max())

def _recentered(quad: np.ndarray, box: np.ndarray, inverse: np.ndarray) -> np.ndarray:
    centre = np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
    half = max(box[2] - box[0], box[3] - box[1]) / (2 * (1 - 2 * PATTERN_MARGIN))
    corners = np.array([[centre[0] + sx * half, centre[1] + sy * half] for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]) * 100
    homogeneous = np.hstack([corners, np.ones((4, 1))]) @ inverse.T
    return order_corners((homogeneous[:, :2] / homogeneous[:, 2:3]).astype(np.float32))

def _evaluate(gray: np.ndarray, quad: np.ndarray) -> tuple[np.ndarray, dict] | None:
    quad, edge = refine_quad(gray, quad)
    if edge < 0.5:
        return None
    squareness, max_cos = quad_metrics(quad)
    if squareness < 0.6 or max_cos > 0.45:
        return None
    pattern, ring = _marker_pattern(gray, quad)
    if pattern < 0.25 or ring < 0.15:
        return None
    found = _pattern_box(gray, quad)
    deviation = _layout_deviation(found[0]) if found else LAYOUT_TOLERANCE
    layout = max(0.0, 1.0 - deviation / LAYOUT_TOLERANCE)
    confidence = squareness ** 2 * edge ** 3 * (0.4 + 0.6 * pattern) * (0.4 + 0.6 * ring) * (0.3 + 0.7 * layout)
    return quad, {"squareness": squareness, "pattern": pattern, "confidence": confidence, "deviation": deviation, "found": found}

def _score_candidates(candidates, gray_full, scale, side_mm, frame_side) -> list[dict]:
    found: list[dict] = []
    seen: list[np.ndarray] = []
    for _, coarse in candidates:
        quad = coarse / scale
        if any(np.abs(quad - other).max() < 0.012 * frame_side for other in seen):
            continue
        seen.append(quad)
        evaluated = _evaluate(gray_full, quad)
        if evaluated is None:
            continue
        quad, info = evaluated
        for _ in range(RECENTER_PASSES):
            if info["found"] is None or info["deviation"] <= RECENTER_FROM_DEVIATION:
                break
            moved = _evaluate(gray_full, _recentered(quad, *info["found"]))
            if moved is None or moved[1]["confidence"] <= info["confidence"]:
                break
            quad, info = moved
        side_px = corners_side_px(quad)
        found.append({"corners": quad.round(2).tolist(), "side_px": float(side_px),
                      "px_per_mm": px_per_mm(side_px, side_mm), "squareness": round(float(info["squareness"]), 3),
                      "pattern_score": round(float(info["pattern"]), 3),
                      "confidence": round(float(min(1.0, info["confidence"])), 3), "kind": "marker"})
    return found

def find_marker(img: np.ndarray, side_mm: float, max_candidates: int = 3) -> list[dict]:
    height, width = img.shape[:2]
    scale = min(1.0, LSD_MAX_SIDE / max(height, width))
    small = cv2.resize(img, (max(8, int(width * scale)), max(8, int(height * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else img
    gray_small = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    small_h, small_w = gray_small.shape
    segments = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD).detect(gray_small)[0]
    if segments is None or len(segments) == 0:
        return []
    side_min, side_max = 0.08 * max(small_h, small_w), 0.85 * min(small_h, small_w)
    lines = _merge_lines(segments, side_min * 0.6)
    drawn = np.zeros((small_h, small_w), np.uint8)
    for x1, y1, x2, y2 in segments.reshape(-1, 4):
        if np.hypot(x2 - x1, y2 - y1) >= 0.3 * side_min:
            cv2.line(drawn, (int(x1), int(y1)), (int(x2), int(y2)), 255, 3)
    pairs = _parallel_pairs(lines, side_min, side_max)
    candidates = _candidates_from_four_lines(lines, pairs, drawn, small_w, small_h)
    candidates += _candidates_with_completed_side(lines, pairs, drawn, small_w, small_h)
    candidates.sort(key=lambda item: item[0], reverse=True)
    candidates = [(score, quad) for score, quad in candidates
                  if quad_metrics(quad)[0] >= 0.6 and quad_metrics(quad)[1] <= 0.5][:MAX_CANDIDATES_REFINED]
    gray_full = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    found = _score_candidates(candidates, gray_full, scale, side_mm, max(height, width))
    found.sort(key=lambda item: item["confidence"], reverse=True)
    return _without_duplicates(found, 0.012 * max(height, width))[:max_candidates]

def _without_duplicates(found: list[dict], tolerance: float) -> list[dict]:
    unique: list[dict] = []
    for item in found:
        corners = np.array(item["corners"])
        if all(np.abs(corners - np.array(other["corners"])).max() >= tolerance for other in unique):
            unique.append(item)
    return unique
