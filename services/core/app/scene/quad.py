from __future__ import annotations
import cv2
import numpy as np
from ..calibration import order_corners

EDGE_GRADIENT_MIN = 35.0
EDGE_MIN_GOOD_POINTS = 6
EDGE_SAMPLES = 31

_NEXT = [1, 2, 3, 0]

def quad_metrics(quad: np.ndarray) -> tuple[float, float]:
    sides = [float(np.linalg.norm(quad[i] - quad[(i + 1) % 4])) for i in range(4)]
    cosines = []
    for i in range(4):
        prev_pt, pt, next_pt = quad[(i - 1) % 4], quad[i], quad[(i + 1) % 4]
        u, v = prev_pt - pt, next_pt - pt
        cosines.append(abs(float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9))))
    return min(sides) / max(sides), max(cosines)

def side_lengths(quad: np.ndarray) -> np.ndarray:
    return np.linalg.norm(quad - quad[_NEXT], axis=1)

def sample_side(quad: np.ndarray, index: int, t_from: float, t_to: float, count: int) -> np.ndarray:
    a, b = quad[index], quad[(index + 1) % 4]
    return a[None, :] + np.linspace(t_from, t_to, count)[:, None] * (b - a)[None, :]

_COVERAGE_T = np.linspace(0.05, 0.95, 40)

def side_coverage(mask: np.ndarray, quad: np.ndarray) -> list[float]:
    h, w = mask.shape
    start, end = quad, quad[_NEXT]
    pts = start[:, None, :] + _COVERAGE_T[None, :, None] * (end - start)[:, None, :]
    xi = np.minimum(np.maximum(np.rint(pts[..., 0]), 0), w - 1).astype(np.intp)
    yi = np.minimum(np.maximum(np.rint(pts[..., 1]), 0), h - 1).astype(np.intp)
    return (mask[yi, xi] > 0).mean(axis=1).tolist()

def outward_normal(a: np.ndarray, b: np.ndarray, center: np.ndarray) -> np.ndarray:
    d = b - a
    n = np.array([d[1], -d[0]])
    n = n / (np.linalg.norm(n) + 1e-9)
    return -n if np.dot(n, (a + b) / 2 - center) < 0 else n

def refine_quad(gray: np.ndarray, quad: np.ndarray) -> tuple[np.ndarray, float]:
    q = order_corners(quad).astype(np.float64)
    center = q.mean(axis=0)
    size = float(np.sqrt(cv2.contourArea(q.astype(np.float32))))
    reach = max(4, int(0.07 * size))
    gray_f = gray.astype(np.float32)
    fitted_lines, shares, weak_sides = [], [], 0
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        d = b - a
        if float(np.linalg.norm(d)) < 5:
            return quad, 0.0
        n = outward_normal(a, b, center)
        ts = np.linspace(0.15, 0.85, EDGE_SAMPLES)
        offsets = np.arange(-reach, reach + 1, dtype=np.float64)
        px = (a[None, :] + ts[:, None] * d[None, :])[:, None, :] + offsets[None, :, None] * n[None, None, :]
        profile = cv2.remap(gray_f, px[:, :, 0].astype(np.float32), px[:, :, 1].astype(np.float32),
                            cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        step = max(2, reach // 3)
        grad = profile[:, step:] - profile[:, :-step]
        grad = np.concatenate([np.zeros((len(ts), step // 2)), grad, np.zeros((len(ts), step - step // 2))], axis=1)
        best = np.argmax(grad, axis=1)
        good = grad[np.arange(len(ts)), best] > EDGE_GRADIENT_MIN
        shares.append(float(good.mean()))
        if good.sum() < EDGE_MIN_GOOD_POINTS:
            weak_sides += 1
            if weak_sides > 1:
                return quad, 0.0
            fitted_lines.append((a.copy(), d / np.linalg.norm(d)))
            continue
        pts = (a[None, :] + ts[:, None] * d[None, :] + offsets[best][:, None] * n[None, :])[good]
        vx, vy, x0, y0 = cv2.fitLine(pts.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        fitted_lines.append((np.array([x0, y0], np.float64), np.array([vx, vy], np.float64)))
    corners = []
    for i in range(4):
        (p1, d1), (p2, d2) = fitted_lines[i - 1], fitted_lines[i]
        system = np.array([d1, -d2]).T
        if abs(np.linalg.det(system)) < 1e-6:
            return quad, 0.0
        s = np.linalg.solve(system, p2 - p1)
        corners.append(p1 + s[0] * d1)
    return order_corners(np.array(corners, np.float32)), float(sorted(shares)[1])
