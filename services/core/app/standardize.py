from __future__ import annotations
import os
import cv2
import numpy as np
from .calibration import find_reference_square, order_corners

EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}
MAX_SIDE = 6000

def standardize(img: np.ndarray, corners, side_mm: float, target_px_per_mm: float = 20.0) -> tuple[np.ndarray, dict]:
    src = order_corners(np.array(corners, dtype=np.float32))
    s = side_mm * target_px_per_mm
    dst = np.array([[0, 0], [s, 0], [s, s], [0, s]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(src, dst)
    h, w = img.shape[:2]
    frame = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32).reshape(-1, 1, 2)
    moved = cv2.perspectiveTransform(frame, H).reshape(-1, 2)
    x0, y0 = moved.min(0)
    x1, y1 = moved.max(0)
    k = min(1.0, MAX_SIDE / max(x1 - x0, y1 - y0))
    T = np.array([[k, 0, -x0 * k], [0, k, -y0 * k], [0, 0, 1]], dtype=np.float64)
    size = (int(round((x1 - x0) * k)), int(round((y1 - y0) * k)))
    out = cv2.warpPerspective(img, T @ H, size, flags=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    return out, {"px_per_mm": target_px_per_mm * k, "width": size[0], "height": size[1], "scale_applied": k}

def scan_folder(folder: str, side_mm: float = 10.0, min_confidence: float = 0.6) -> list[dict]:
    rows = []
    for name in sorted(os.listdir(folder)):
        if os.path.splitext(name)[1].lower() not in EXT:
            continue
        img = cv2.imread(os.path.join(folder, name), cv2.IMREAD_COLOR)
        if img is None:
            rows.append({"file": name, "status": "unreadable"})
            continue
        res = find_reference_square(img, side_mm, 1)
        if not res["found"] or res["candidates"][0]["confidence"] < min_confidence:
            rows.append({"file": name, "status": "no_reference", "width": img.shape[1], "height": img.shape[0]})
            continue
        c = res["candidates"][0]
        rows.append({"file": name, "status": "ok", "width": img.shape[1], "height": img.shape[0],
                     "px_per_mm": c["px_per_mm"], "confidence": c["confidence"], "squareness": c["squareness"],
                     "rel_error": 0.5 / c["side_px"], "corners": c["corners"]})
    return rows
