from __future__ import annotations
import cv2
import numpy as np
from .geometry import corners_side_px, px_per_mm, scale_error_rel

def order_corners(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)

def _checker_score(gray: np.ndarray, corners: np.ndarray) -> float:
    size = 64
    dst = np.array([[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(corners, dst)
    w = cv2.warpPerspective(gray, M, (size, size))
    h = size // 2
    m = 6
    q = lambda y0, y1, x0, x1: float(w[y0 + m:y1 - m, x0 + m:x1 - m].mean())
    a, b = q(0, h, 0, h), q(0, h, h, size)
    c, d = q(h, size, 0, h), q(h, size, h, size)
    diag = (abs(a - d) + abs(b - c)) / 2.0
    cross = (abs((a + d) / 2.0 - (b + c) / 2.0))
    if cross < 30:
        return 0.0
    return float(max(0.0, min(1.0, (cross - diag) / 255.0 * 2.0 + 0.0)))

def _squares(mask: np.ndarray, W: int, H: int):
    out = []
    cnts, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in cnts:
        area = cv2.contourArea(c)
        if area < 0.00005 * W * H or area > 0.08 * W * H:
            continue
        rect = cv2.minAreaRect(c)
        rw, rh = rect[1]
        if min(rw, rh) < 6:
            continue
        if min(rw, rh) / max(rw, rh) < 0.85 or area / (rw * rh) < 0.85:
            continue
        out.append((np.array(rect[0]), (rw + rh) / 2.0, rect[2] % 90.0, cv2.boxPoints(rect)))
    return out

def _refine_square(gray: np.ndarray, pts: np.ndarray, centers: list[np.ndarray]) -> np.ndarray:
    H, W = gray.shape
    side = float(np.mean([np.linalg.norm(pts[i] - pts[(i + 1) % 4]) for i in range(4)]))
    m = int(max(5, side * 0.04 + 3))
    x0, y0 = np.maximum(pts.min(0).astype(int) - m, 0)
    x1, y1 = np.minimum(pts.max(0).astype(int) + m + 1, [W, H])
    roi = cv2.GaussianBlur(gray[y0:y1, x0:x1], (0, 0), 1.0)
    inner = [float(np.median(roi[int(c[1]) - y0 - 2:int(c[1]) - y0 + 3, int(c[0]) - x0 - 2:int(c[0]) - x0 + 3])) for c in centers]
    poly = np.zeros(roi.shape, np.uint8)
    cv2.fillPoly(poly, [np.round(pts - [x0, y0]).astype(np.int32)], 255)
    ring = cv2.dilate(poly, np.ones((2 * m + 1, 2 * m + 1), np.uint8)) & ~cv2.dilate(poly, np.ones((5, 5), np.uint8))
    if ring.sum() == 0:
        return pts
    p_in, q_out = float(np.mean(inner)), float(np.median(roi[ring > 0]))
    if abs(p_in - q_out) < 40:
        return pts
    t = (p_in + q_out) / 2
    mask = ((roi < t) if p_in < q_out else (roi > t)).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    parts = [c for c in cnts if any(cv2.pointPolygonTest(c, (float(ce[0] - x0), float(ce[1] - y0)), False) >= 0 for ce in centers)]
    if not parts:
        return pts
    u = (pts[1] - pts[0]); u = u / np.linalg.norm(u); w_ = np.array([-u[1], u[0]])
    allp = np.vstack([c.reshape(-1, 2).astype(float) for c in parts]) + [x0, y0]
    pu, pw = allp @ u, allp @ w_
    lo_u, hi_u, lo_w, hi_w = pu.min() - 0.5, pu.max() + 0.5, pw.min() - 0.5, pw.max() + 0.5
    new = np.array([u * a + w_ * b for a, b in [(lo_u, lo_w), (hi_u, lo_w), (hi_u, hi_w), (lo_u, hi_w)]])
    if np.abs(order_corners(new) - pts).max() > 4:
        return pts
    return order_corners(new)

def find_reference_square(img_bgr: np.ndarray, side_mm: float = 10.0, max_candidates: int = 5) -> dict:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    cands: list[dict] = []
    seen: list[np.ndarray] = []
    masks = []
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks += [otsu, cv2.bitwise_not(otsu)]
    masks.append(cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 101, 8))
    for m in masks:
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        sq = _squares(m, W, H)
        for i in range(len(sq)):
            for j in range(i + 1, len(sq)):
                (c1, s1, a1, b1), (c2, s2, a2, b2) = sq[i], sq[j]
                if abs(s1 - s2) / max(s1, s2) > 0.12:
                    continue
                s_ = (s1 + s2) / 2.0
                v = c2 - c1
                dist = float(np.hypot(*v))
                if abs(dist - s_ * np.sqrt(2)) / (s_ * np.sqrt(2)) > 0.15:
                    continue
                ang = abs(((np.degrees(np.arctan2(v[1], v[0])) - a1) % 90.0) - 45.0)
                if ang > 12:
                    continue
                u = b1[1] - b1[0]
                u = u / np.linalg.norm(u)
                w_ = np.array([-u[1], u[0]])
                allp = np.vstack([b1, b2])
                pu, pw = allp @ u, allp @ w_
                pts = order_corners(np.array([u * a + w_ * b for a, b in
                                              [(pu.min(), pw.min()), (pu.max(), pw.min()), (pu.max(), pw.max()), (pu.min(), pw.max())]]))
                if any(np.abs(pts - q).max() < 6 for q in seen):
                    continue
                pts = _refine_square(gray, pts, [c1, c2])
                score = _checker_score(gray, pts)
                if score <= 0.15:
                    continue
                seen.append(pts)
                side_px = corners_side_px(pts)
                sides = [np.linalg.norm(pts[k] - pts[(k + 1) % 4]) for k in range(4)]
                ratio = min(sides) / max(sides)
                conf = min(1.0, 0.5 * min(1.0, score * 2) + 0.5 * ratio)
                cands.append({
                    "corners": pts.round(2).tolist(),
                    "side_px": float(side_px),
                    "px_per_mm": px_per_mm(side_px, side_mm),
                    "squareness": round(float(ratio), 3),
                    "pattern_score": round(float(score), 3),
                    "confidence": round(float(conf), 3),
                })
    cands.sort(key=lambda c: c["confidence"], reverse=True)
    return {"found": bool(cands), "candidates": cands[:max_candidates]}

def calibration_from_corners(corners, side_mm: float = 10.0, method: str = "manual") -> dict:
    side_px = corners_side_px(corners)
    k = px_per_mm(side_px, side_mm)
    pts = order_corners(np.array(corners))
    sides = [float(np.linalg.norm(pts[i] - pts[(i + 1) % 4])) for i in range(4)]
    squareness = min(sides) / max(sides)
    rel = scale_error_rel(side_px)
    conf = max(0.0, min(1.0, squareness * (1 - min(1, rel * 20))))
    return {
        "corners": [[float(x), float(y)] for x, y in corners],
        "side_px": side_px,
        "side_mm": side_mm,
        "px_per_mm": k,
        "rel_error": rel,
        "squareness": round(squareness, 4),
        "confidence": round(conf, 3),
        "method": method,
    }
