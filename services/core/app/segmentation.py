from __future__ import annotations
import cv2
import numpy as np
from .geometry import area_mm2, shoelace_area_px

CHANNELS = ("rgb", "g", "lab")

def channel_image(img_bgr: np.ndarray, channel: str) -> np.ndarray:
    if channel == "g":
        return img_bgr[:, :, 1]
    if channel == "lab":
        return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)[:, :, 0]
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

def histogram(img_bgr: np.ndarray, channel: str) -> list[int]:
    ch = channel_image(img_bgr, channel)
    return cv2.calcHist([ch], [0], None, [64], [0, 256]).ravel().astype(int).tolist()

def otsu_range(img_bgr: np.ndarray, channel: str) -> tuple[int, int]:
    t, _ = cv2.threshold(channel_image(img_bgr, channel), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return int(t), 255

def erase_disks(shape: tuple[int, int], circles: list[list[float]]) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    for cx, cy, r in circles:
        cv2.circle(m, (int(round(cx)), int(round(cy))), max(1, int(round(r))), 255, -1)
    return m

def _bridge(outer: np.ndarray, holes: list[np.ndarray]) -> np.ndarray:
    poly = outer
    for h in holes:
        d = np.linalg.norm(poly[:, None, :] - h[None, :, :], axis=2)
        i, j = np.unravel_index(int(d.argmin()), d.shape)
        hr = np.roll(h, -int(j), axis=0)
        poly = np.concatenate([poly[: i + 1], hr, hr[:1], poly[i: i + 1], poly[i + 1:]])
    return poly

def segment(img_bgr: np.ndarray, k: float, channel: str = "g", low: int | None = None, high: int | None = None,
            smooth_px: float = 2.0, min_area_mm2: float = 0.5, fill_holes: bool = True,
            exclude_rect: list[list[float]] | None = None, max_regions: int = 12, prior_mask: np.ndarray | None = None,
            erase: list[list[float]] | None = None) -> dict:
    if channel not in CHANNELS:
        raise ValueError(f"Неизвестный канал: {channel}")
    ch = channel_image(img_bgr, channel)
    if low is None or high is None:
        low, high = otsu_range(img_bgr, channel)
    if smooth_px > 0:
        ksz = int(max(1, round(smooth_px)) * 2 + 1)
        ch = cv2.GaussianBlur(ch, (ksz, ksz), 0)
    mask = cv2.inRange(ch, int(low), int(high)) if prior_mask is None else (prior_mask > 0).astype(np.uint8) * 255
    if exclude_rect:
        pts = np.array(exclude_rect, dtype=np.int32)
        x, y, w, h = cv2.boundingRect(pts)
        pad = int(0.15 * max(w, h))
        cv2.rectangle(mask, (x - pad, y - pad), (x + w + pad, y + h + pad), 0, -1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    disks = erase_disks(mask.shape, erase or []) if erase else None
    if disks is not None:
        if fill_holes:
            ext, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            filled = np.zeros_like(mask)
            cv2.drawContours(filled, ext, -1, 255, -1)
            mask = filled
        mask[disks > 0] = 0
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mode = cv2.RETR_CCOMP if disks is not None and fill_holes else (cv2.RETR_EXTERNAL if fill_holes else cv2.RETR_LIST)
    cnts, hier = cv2.findContours(mask, mode, cv2.CHAIN_APPROX_SIMPLE)
    simp = lambda c: cv2.approxPolyDP(c, 0.001 * cv2.arcLength(c, True), True).reshape(-1, 2).astype(float)
    regions = []
    for n, c in enumerate(cnts):
        if mode == cv2.RETR_CCOMP and hier[0][n][3] >= 0:
            continue
        poly = simp(c)
        if mode == cv2.RETR_CCOMP and len(poly) >= 3:
            holes = [simp(cnts[m]) for m in range(len(cnts)) if hier[0][m][3] == n and len(cnts[m]) >= 3]
            holes = [h for h in holes if len(h) >= 3]
            if holes:
                poly = _bridge(poly, holes)
        if len(poly) < 3:
            continue
        a_px = shoelace_area_px(poly.tolist())
        a_mm = area_mm2(a_px, k)
        if a_mm < min_area_mm2:
            continue
        regions.append({"vertices": poly.round(1).tolist(), "area_px": a_px, "area_mm2": a_mm})
    regions.sort(key=lambda r: r["area_mm2"], reverse=True)
    regions = regions[:max_regions]
    coverage = float((mask > 0).mean())
    return {"method": "color_grabcut" if prior_mask is not None else "threshold",
            "low": int(low), "high": int(high), "channel": channel, "regions": regions,
            "coverage": coverage, "erase_applied": len(erase or []), "total_area_mm2": sum(r["area_mm2"] for r in regions),
            "histogram": histogram(img_bgr, channel)}
