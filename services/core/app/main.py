from __future__ import annotations
import copy
import os
import threading
from collections import OrderedDict
from typing import Literal
import cv2
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator
from . import calibration as cal, scene, compare as cmpm, geometry as g, report as rep, segmentation as seg, standardize as std

DATA_DIR = os.environ.get("DATA_DIR", "/data")
app = FastAPI(title="МасштабЛаб core", version="1.0.0")

def load(path: str):
    full = os.path.realpath(os.path.join(DATA_DIR, path)) if not os.path.isabs(path) else os.path.realpath(path)
    if not full.startswith(os.path.realpath(DATA_DIR) + os.sep):
        raise HTTPException(400, "Путь вне каталога данных")
    img = cv2.imread(full, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(404, "Снимок не найден или не читается")
    return img, full

_RESULTS: "OrderedDict[tuple, dict]" = OrderedDict()
_RESULTS_LIMIT = 48
_RESULTS_LOCK = threading.Lock()

def memoized(kind: str, body: "CalibrateIn", compute):
    img, full = load(body.image_path)
    key = (kind, full, os.stat(full).st_mtime_ns, round(body.side_mm, 6), round(body.marker_side_mm, 6))
    with _RESULTS_LOCK:
        if key in _RESULTS:
            _RESULTS.move_to_end(key)
            return copy.deepcopy(_RESULTS[key])
    result = compute(img)
    with _RESULTS_LOCK:
        _RESULTS[key] = copy.deepcopy(result)
        while len(_RESULTS) > _RESULTS_LIMIT:
            _RESULTS.popitem(last=False)
    return result

Pt = list[float]

class CalibrateIn(BaseModel):
    image_path: str
    side_mm: float = Field(10.0, gt=0)
    marker_side_mm: float = Field(50.0, gt=0)

class ManualCalIn(BaseModel):
    corners: list[Pt]
    side_mm: float = Field(10.0, gt=0)

    @field_validator("corners")
    @classmethod
    def four(cls, v):
        if len(v) != 4 or any(len(p) != 2 for p in v):
            raise ValueError("Нужно ровно 4 угла [x, y]")
        return v

class MeasureIn(BaseModel):
    kind: Literal["polygon", "line", "angle", "circle"]
    vertices: list[Pt]
    px_per_mm: float = Field(gt=0)
    rel_error: float = 0.0

class SegmentIn(BaseModel):
    image_path: str
    px_per_mm: float = Field(gt=0)
    channel: Literal["rgb", "g", "lab"] = "g"
    low: int | None = Field(None, ge=0, le=255)
    high: int | None = Field(None, ge=0, le=255)
    smooth_px: float = 2.0
    min_area_mm2: float = 0.5
    fill_holes: bool = True
    exclude_corners: list[Pt] | None = None
    erase: list[list[float]] = Field(default_factory=list, max_length=300)

class StandardizeIn(BaseModel):
    image_path: str
    corners: list[Pt]
    side_mm: float = Field(10.0, gt=0)
    target_px_per_mm: float = Field(20.0, gt=0, le=200)

    @field_validator("corners")
    @classmethod
    def four(cls, v):
        if len(v) != 4 or any(len(p) != 2 for p in v):
            raise ValueError("Нужно ровно 4 угла [x, y]")
        return v

class BatchIn(BaseModel):
    folder: str
    side_mm: float = Field(10.0, gt=0)

class CompareIn(BaseModel):
    a: dict
    b: dict

class OverlayIn(BaseModel):
    image_path: str
    measurements: list[dict]

@app.exception_handler(Exception)
async def unexpected_error(_request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})

@app.get("/health")
def health():
    return {"ok": True, "service": "core", "opencv": cv2.__version__}

@app.post("/calibrate")
def calibrate(body: CalibrateIn):
    def compute(img):
        res = scene.find_reference(img, body.side_mm, marker_side_mm=body.marker_side_mm)
        res["image"] = {"width": img.shape[1], "height": img.shape[0]}
        return res
    return memoized("calibrate", body, compute)

@app.post("/analyze")
def analyze(body: CalibrateIn):
    def compute(img):
        ref = scene.find_reference(img, body.side_mm, marker_side_mm=body.marker_side_mm)
        best = ref["candidates"][0] if ref["candidates"] else None
        requested_side = body.side_mm if best is None or best["kind"] == "checker" else best["side_mm"]
        out = scene.analyze(img, requested_side, best)
        out["found"] = bool(ref["candidates"])
        out["candidates"] = ref["candidates"]
        out["image"] = {"width": img.shape[1], "height": img.shape[0]}
        return out
    return memoized("analyze", body, compute)

@app.post("/calibration/manual")
def calibration_manual(body: ManualCalIn):
    try:
        return cal.calibration_from_corners(body.corners, body.side_mm)
    except ValueError as e:
        raise HTTPException(422, str(e))

@app.post("/standardize")
def standardize(body: StandardizeIn):
    img, _ = load(body.image_path)
    try:
        out, info = std.standardize(img, body.corners, body.side_mm, body.target_px_per_mm)
    except (ValueError, cv2.error) as e:
        raise HTTPException(422, f"Не удалось выпрямить снимок: {e}")
    ok, png = cv2.imencode(".png", out)
    return Response(png.tobytes(), media_type="image/png", headers={"X-Px-Per-Mm": f"{info['px_per_mm']:.4f}"})

@app.post("/batch")
def batch(body: BatchIn):
    root = os.path.realpath(DATA_DIR)
    full = os.path.realpath(os.path.join(root, body.folder))
    if not (full + os.sep).startswith(root + os.sep) or not os.path.isdir(full):
        raise HTTPException(404, "Папка не найдена в каталоге данных")
    return {"folder": body.folder, "items": std.scan_folder(full, body.side_mm)}

@app.post("/measure")
def measure(body: MeasureIn):
    k, rel, v = body.px_per_mm, body.rel_error, body.vertices
    try:
        if body.kind == "polygon":
            return g.measure_polygon(v, k, rel)
        if body.kind == "line":
            return g.measure_line(v, k, rel)
        if body.kind == "angle":
            return g.measure_angle(v)
        return g.measure_circle(v, k, rel)
    except ValueError as e:
        raise HTTPException(422, str(e))

@app.post("/segment")
def segment(body: SegmentIn):
    img, _ = load(body.image_path)
    prior = None
    if body.low is None or body.high is None:
        obj = scene.locate_object(img, body.exclude_corners)
        if obj["found"] and obj["confidence"] >= 0.3:
            prior = obj["mask"]
    try:
        return seg.segment(img, body.px_per_mm, body.channel, body.low, body.high, body.smooth_px,
                           body.min_area_mm2, body.fill_holes, body.exclude_corners, prior_mask=prior,
                           erase=[c for c in body.erase if len(c) == 3])
    except ValueError as e:
        raise HTTPException(422, str(e))

@app.post("/compare")
def compare(body: CompareIn):
    try:
        return cmpm.compare_samples(body.a, body.b)
    except KeyError as e:
        raise HTTPException(422, f"Нет поля {e}")

@app.post("/report/pdf")
def report_pdf(payload: dict):
    return Response(rep.to_pdf(payload), media_type="application/pdf")

@app.post("/report/csv")
def report_csv(payload: dict):
    return Response(rep.to_csv(payload), media_type="text/csv; charset=utf-8")

@app.post("/report/hash")
def report_hash(payload: dict):
    return {"sha256": rep.payload_sha256(payload)}

@app.post("/report/overlay")
def report_overlay(body: OverlayIn):
    _, full = load(body.image_path)
    return Response(rep.overlay_png(full, body.measurements), media_type="image/png")

