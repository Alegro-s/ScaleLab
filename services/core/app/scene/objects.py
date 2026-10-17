from __future__ import annotations
import cv2
import numpy as np

WORK_SIZE = 320
CLUSTERS = 5
KMEANS_SEED = 7
MIN_CLUSTER_SHARE = 0.01
SIMILAR_COLOR_DIST = 14.0
KEEP_COMPONENT_SHARE = 0.15

def _not_found(reason: str) -> dict:
    return {"found": False, "reason": reason}

def _valid_area(shape: tuple[int, int], marker_corners, scale: float) -> np.ndarray:
    h, w = shape
    valid = np.ones((h, w), np.uint8)
    if marker_corners is None:
        return valid
    q = np.array(marker_corners, dtype=np.float32) * scale
    marker = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(marker, q.astype(np.int32), 1)
    pad = max(3, int(0.12 * np.sqrt(cv2.contourArea(q))))
    valid[cv2.dilate(marker, np.ones((pad * 2 + 1, pad * 2 + 1), np.uint8)) > 0] = 0
    return valid

def _color_clusters(blur: np.ndarray, valid: np.ndarray) -> list[dict]:
    h, w = valid.shape
    lab = cv2.cvtColor(blur, cv2.COLOR_BGR2LAB).astype(np.float32)
    features = np.dstack([lab[:, :, 0] * 0.5, lab[:, :, 1], lab[:, :, 2]]).reshape(-1, 3)
    valid_flat = valid.ravel() > 0
    cv2.setRNGSeed(KMEANS_SEED)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    _, labels, centers = cv2.kmeans(features[valid_flat], CLUSTERS, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    label_map = np.full(h * w, -1, np.int32)
    label_map[valid_flat] = labels.ravel()
    label_map = label_map.reshape(h, w)
    border = np.zeros((h, w), bool)
    border[:3, :] = border[-3:, :] = border[:, :3] = border[:, -3:] = True
    clusters = []
    for k in range(CLUSTERS):
        mask = (label_map == k).astype(np.uint8)
        pixels = int(mask.sum())
        if pixels < MIN_CLUSTER_SHARE * h * w:
            continue
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        count, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        if count < 2:
            continue
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        biggest_area = int(stats[biggest, cv2.CC_STAT_AREA])
        touch = float(((label_map == k) & border).sum()) / max(1, int(border.sum()))
        clusters.append({"n": pixels, "cc": biggest, "a_cc": biggest_area, "compact": biggest_area / max(1, pixels),
                         "touch": touch, "center": centers[k], "ccmap": components})
    return clusters

def _pick_object_cluster(clusters: list[dict], shape: tuple[int, int]) -> tuple[dict, dict | None, float]:
    h, w = shape
    background = max(clusters, key=lambda c: c["touch"] * 1.0 + 0.3 * c["n"] / (h * w))
    best, best_score = None, 0.0
    for cluster in clusters:
        if cluster is background:
            continue
        distance = float(np.linalg.norm(cluster["center"][1:] - background["center"][1:])
                         + 0.5 * abs(cluster["center"][0] - background["center"][0]))
        chroma = float(np.linalg.norm(cluster["center"][1:] - 128.0))
        greenness = max(0.0, 128.0 - float(cluster["center"][1])) / 40.0
        score = (distance * (0.6 + 0.4 * min(1.0, cluster["a_cc"] / (0.05 * h * w)))
                 * (0.5 + 0.5 * cluster["compact"]) * (1.0 - 0.5 * cluster["touch"])
                 * (1.0 + 0.5 * min(1.0, chroma / 30.0 + greenness)))
        if score > best_score:
            best, best_score = cluster, score
    return background, best, best_score

def _grabcut_refine(blur: np.ndarray, prior: np.ndarray, valid: np.ndarray) -> np.ndarray:
    mask = np.full(prior.shape, cv2.GC_PR_BGD, np.uint8)
    mask[cv2.dilate(prior, np.ones((21, 21), np.uint8)) == 0] = cv2.GC_BGD
    mask[prior > 0] = cv2.GC_PR_FGD
    mask[cv2.erode(prior, np.ones((7, 7), np.uint8)) > 0] = cv2.GC_FGD
    mask[valid == 0] = cv2.GC_BGD
    try:
        bgd_model, fgd_model = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        cv2.grabCut(blur, mask, None, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_MASK)
        return ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)
    except cv2.error:
        return prior

def _keep_large_components(mask: np.ndarray) -> np.ndarray | None:
    count, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count < 2:
        return None
    areas = stats[1:, cv2.CC_STAT_AREA]
    kept = np.zeros_like(mask)
    for i, area in enumerate(areas, start=1):
        if area >= KEEP_COMPONENT_SHARE * areas.max():
            kept[components == i] = 1
    return cv2.morphologyEx(kept, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

def locate_object(img: np.ndarray, marker_corners=None) -> dict:
    height, width = img.shape[:2]
    scale = WORK_SIZE / max(height, width)
    small = cv2.resize(img, (max(8, int(width * scale)), max(8, int(height * scale))), interpolation=cv2.INTER_AREA)
    h, w = small.shape[:2]
    blur = cv2.GaussianBlur(small, (5, 5), 0)
    valid = _valid_area((h, w), marker_corners, scale)
    if int((valid > 0).sum()) < 200:
        return _not_found("мало пикселей вне маркера")
    clusters = _color_clusters(blur, valid)
    if len(clusters) < 2:
        return _not_found("на снимке один цвет")
    background, best, best_score = _pick_object_cluster(clusters, (h, w))
    if best is None:
        return _not_found("объект не выделяется по цвету")
    similar = [c for c in clusters if c is not background and c is not best
               and float(np.linalg.norm(c["center"][1:] - best["center"][1:])) < SIMILAR_COLOR_DIST]
    prior = np.zeros((h, w), np.uint8)
    for cluster in [best] + similar:
        prior[cluster["ccmap"] == cluster["cc"]] = 1
    prior = cv2.morphologyEx(prior, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    if prior.sum() < 60:
        return _not_found("область объекта слишком мала")
    refined = cv2.morphologyEx(_grabcut_refine(blur, prior, valid), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    kept = _keep_large_components(refined)
    if kept is None:
        return _not_found("после уточнения объект пропал")
    full = cv2.resize(kept, (width, height), interpolation=cv2.INTER_NEAREST)
    ys, xs = np.nonzero(full)
    mean_bgr = img[full > 0].mean(axis=0)
    return {"found": True, "mask": full, "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            "centroid": [float(xs.mean()), float(ys.mean())], "area_frac": round(float(full.mean()), 4),
            "color_rgb": [int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0])],
            "confidence": round(float(min(1.0, best_score / 60.0)), 3)}

def mask_polygons(mask: np.ndarray, min_area: float = 50.0, max_regions: int = 6) -> list[list[list[float]]]:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:max_regions]:
        if cv2.contourArea(contour) < min_area:
            continue
        approx = cv2.approxPolyDP(contour, 0.001 * cv2.arcLength(contour, True), True).reshape(-1, 2)
        if len(approx) >= 3:
            polygons.append(approx.astype(float).round(1).tolist())
    return polygons
