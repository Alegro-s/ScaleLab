from __future__ import annotations
import numpy as np
import cv2

def add_checker(img: np.ndarray, x: int, y: int, side_px: int, angle_deg: float = 0.0) -> tuple[np.ndarray, list[list[float]]]:
    out = img.copy()
    pad = max(4, side_px // 12)
    cv2.rectangle(out, (x - pad, y - pad), (x + side_px + pad, y + side_px + pad), (255, 255, 255), -1)
    h = side_px // 2
    cv2.rectangle(out, (x, y), (x + h, y + h), (10, 10, 10), -1)
    cv2.rectangle(out, (x + h, y + h), (x + 2 * h, y + 2 * h), (10, 10, 10), -1)
    cv2.rectangle(out, (x + h, y), (x + 2 * h, y + h), (245, 245, 245), -1)
    cv2.rectangle(out, (x, y + h), (x + h, y + 2 * h), (245, 245, 245), -1)
    s = 2 * h
    return out, [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]

def synthetic_scene(w=1200, h=800, side_px=428, seed=1, blob=True):
    rng = np.random.default_rng(seed)
    bg = np.full((h, w, 3), (120, 140, 90), np.uint8)
    noise = rng.integers(-12, 12, (h, w, 3))
    bg = np.clip(bg.astype(int) + noise, 0, 255).astype(np.uint8)
    if blob:
        poly = np.array([[560, 180], [1050, 230], [1100, 560], [800, 700], [600, 520]], np.int32)
        cv2.fillPoly(bg, [poly], (40, 40, 160))
    else:
        poly = None
    img, corners = add_checker(bg, 60, 60, side_px)
    return img, corners, poly
