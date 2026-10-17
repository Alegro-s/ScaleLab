import os
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATA_DIR", "/tmp/sl_data")
from app import geometry as g, calibration as cal, segmentation as seg, report as rep
from app.demo import synthetic_scene
from app.main import app

client = TestClient(app)

def test_scale_and_area_example_from_kb():
    k = g.px_per_mm(428, 10)
    assert k == pytest.approx(42.8)
    assert g.area_mm2(228401, k) == pytest.approx(124.68, abs=0.01)

def test_shoelace_square_and_perimeter():
    sq = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert g.shoelace_area_px(sq) == 100
    assert g.perimeter_px(sq) == 40
    assert g.shoelace_area_px(sq[::-1]) == 100

def test_angle_and_circle():
    assert g.angle_deg([1, 0], [0, 0], [0, 1]) == pytest.approx(90)
    r = g.measure_circle([[0, 0], [10, 0]], 5.0)
    assert r["value"] == pytest.approx(4.0)

def test_auto_calibration_finds_checker():
    img, corners, _ = synthetic_scene(side_px=428)
    res = cal.find_reference_square(img, 10.0)
    assert res["found"]
    best = res["candidates"][0]
    assert best["px_per_mm"] == pytest.approx(42.8, rel=0.02)
    assert best["confidence"] > 0.6

def test_auto_calibration_no_reference():
    img = np.full((600, 800, 3), 120, np.uint8)
    assert cal.find_reference_square(img)["found"] is False

def test_segmentation_area_close_to_truth():
    img, corners, poly = synthetic_scene(side_px=200)
    k = 20.0
    truth = g.shoelace_area_px(poly.tolist()) / k ** 2
    res = seg.segment(img, k, channel="rgb", low=0, high=90, exclude_rect=corners, min_area_mm2=5)
    assert res["regions"]
    assert res["regions"][0]["area_mm2"] == pytest.approx(truth, rel=0.06)

def test_api_measure_and_compare():
    r = client.post("/measure", json={"kind": "polygon", "px_per_mm": 42.8, "rel_error": 0.001,
                                      "vertices": [[0, 0], [428, 0], [428, 428], [0, 428]]})
    assert r.status_code == 200 and r.json()["value"] == pytest.approx(100.0)
    bad = client.post("/measure", json={"kind": "angle", "px_per_mm": 1, "vertices": [[0, 0], [1, 1]]})
    assert bad.status_code == 422
    c = client.post("/compare", json={"a": {"name": "A", "px_per_mm": 42.8, "area_mm2": 98.4, "perimeter_mm": 38.2},
                                      "b": {"name": "B", "px_per_mm": 42.8, "area_mm2": 124.7, "perimeter_mm": 46.8}}).json()
    assert c["scales_match"] and "больше" in c["verdict"] and c["area_mm2"]["delta_pct"] == pytest.approx(26.7, abs=0.1)

def test_api_rejects_path_escape(tmp_path):
    r = client.post("/calibrate", json={"image_path": "../../etc/passwd", "side_mm": 10})
    assert r.status_code in (400, 404)

def test_report_pdf_and_csv():
    payload = {"title": "Тест", "version": 1, "operator": "И. Виноградов", "session": {"number": 42},
               "sections": {"title": True, "table": True, "formulas": True, "checksum": True},
               "samples": [{"name": "Образец 01", "px_per_mm": 42.8, "side_mm": 10, "confidence": .98,
                            "measurements": [{"label": "К1", "kind": "polygon", "value": 124.68, "unit": "мм²", "perimeter_mm": 46.82, "error": .04}]}],
               "conclusions": ["Площадь 124,68 мм²"]}
    pdf = rep.to_pdf(payload)
    assert pdf[:4] == b"%PDF" and len(pdf) > 1500
    assert "124,680" in rep.to_csv(payload).decode()
    assert len(rep.payload_sha256(payload)) == 64

def test_calibration_has_no_systematic_edge_bias():
    import numpy as np
    from app.demo import synthetic_scene
    from app.calibration import find_reference_square
    for side in (80, 120, 200, 428):
        img, _, _ = synthetic_scene(side_px=side, blob=False)
        c = find_reference_square(img)["candidates"][0]
        true_edge_to_edge = 2 * (side // 2) + 1
        assert abs(c["side_px"] - true_edge_to_edge) < 0.6

def test_standardize_makes_reference_square():
    import cv2, numpy as np
    from app.demo import synthetic_scene
    from app.standardize import standardize
    from app.calibration import find_reference_square
    img, corners, _ = synthetic_scene(side_px=300)
    src = np.float32(corners)
    dst = src + np.float32([[12, -8], [20, 10], [-6, 14], [-14, -4]])
    warped = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (1200, 800), borderMode=cv2.BORDER_REPLICATE)
    out, info = standardize(warped, dst, 10.0, 20.0)
    assert abs(info["px_per_mm"] - 20.0) < 1e-6
    res = find_reference_square(out, 10.0)
    assert res["found"]
    c = res["candidates"][0]
    assert abs(c["px_per_mm"] - 20.0) / 20.0 < 0.03 and c["squareness"] > 0.97

def _scene_image(side=150, angle=8.0):
    import numpy as np, cv2
    rng = np.random.default_rng(3)
    img = np.full((512, 512, 3), (40, 60, 120), np.uint8)
    img = np.clip(img.astype(int) + rng.integers(-15, 15, img.shape), 0, 255).astype(np.uint8)
    cv2.rectangle(img, (60, 300), (60 + side + 30, 300 + side + 30), (170, 200, 215), -1)
    cv2.rectangle(img, (75, 315), (75 + side, 315 + side), (110, 110, 110), -1)
    cv2.rectangle(img, (95, 335), (95 + side // 2, 335 + side // 3), (250, 250, 250), -1)
    cv2.rectangle(img, (95, 335 + side // 2), (95 + side // 4, 335 + side - 25), (250, 250, 250), -1)
    cv2.ellipse(img, (380, 160), (70, 110), 20, 0, 360, (40, 150, 50), -1)
    return img

def test_scene_finds_marker_and_leaf():
    from app import scene
    img = _scene_image()
    r = scene.find_reference(img, 50.0)
    assert r["found"] and r["candidates"][0]["kind"] == "marker"
    k = r["candidates"][0]["px_per_mm"]
    assert abs(k - 150 / 50.0) / 3.0 < 0.03
    a = scene.analyze(img, 50.0, r["candidates"][0])
    assert a["object"] and a["object"]["area_frac"] > 0.05
    cx, cy = a["object"]["centroid"]
    assert abs(cx - 380) < 40 and abs(cy - 160) < 40
    assert a["perspective"]["mode"] == "not_needed"

def test_scene_quad_metrics_and_pipeline_flags():
    import numpy as np
    from app.scene.quad import quad_metrics
    square = np.array([[0, 0], [10, 0], [10, 10], [0, 10]], np.float32)
    squareness, max_cos = quad_metrics(square)
    assert squareness == 1.0 and max_cos < 1e-6
    skewed = np.array([[0, 0], [10, 0], [14, 10], [4, 10]], np.float32)
    assert quad_metrics(skewed)[1] > 0.3
    from app.scene import find_reference
    flat = np.full((200, 200, 3), 120, np.uint8)
    assert find_reference(flat, 10.0) == {"found": False, "candidates": []}

def test_analyze_flags_unreliable_reference_and_size_mismatch():
    import numpy as np
    from app.scene import analyze
    img = np.full((300, 300, 3), 100, np.uint8)
    marker = {"kind": "checker", "px_per_mm": 10.0, "confidence": 0.9, "squareness": 0.99, "side_px": 100.0,
              "side_mm": 10.0, "corners": [[0, 0], [1, 0], [1, 1], [0, 1]], "reliable": True}
    assert not any("отличается" in w for w in analyze(img, 10.0, marker)["warnings"])
    assert any("отличается" in w for w in analyze(img, 12.0, marker)["warnings"])
    weak = {**marker, "reliable": False, "confidence": 0.4}
    out = analyze(img, 10.0, weak)
    assert out["reference"]["needs_confirmation"] is True
    assert any("не сохраняется автоматически" in w for w in out["warnings"])
    assert analyze(img, 10.0, marker)["reference"]["needs_confirmation"] is False

def test_marker_layout_recenters_shifted_quad():
    from app.scene import marker as mk
    img = np.full((400, 400, 3), 200, np.uint8)
    cv2.rectangle(img, (100, 100), (300, 300), (50, 50, 50), -1)
    cv2.rectangle(img, (140, 140), (180, 260), (255, 255, 255), -1)
    cv2.rectangle(img, (140, 220), (260, 260), (255, 255, 255), -1)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    true_quad = np.float32([[100, 100], [300, 100], [300, 300], [100, 300]])
    box, _ = mk._pattern_box(gray, true_quad)
    assert mk._layout_deviation(box) < 0.03
    shifted = true_quad + np.float32([[0, -25], [0, -25], [0, -25], [0, -25]])
    box, inverse = mk._pattern_box(gray, shifted)
    assert mk._layout_deviation(box) > mk.RECENTER_FROM_DEVIATION
    fixed = mk._recentered(shifted, box, inverse)
    assert np.abs(fixed - true_quad).max() < 8

def test_analysis_results_are_memoized_per_image_and_params():
    from app import main
    path = os.path.join(os.environ["DATA_DIR"], "_memo_test.png")
    img = np.full((300, 300, 3), 180, np.uint8)
    cv2.rectangle(img, (80, 80), (200, 200), (40, 40, 40), -1)
    cv2.imwrite(path, img)
    try:
        main._RESULTS.clear()
        body = {"image_path": path, "side_mm": 10}
        first = client.post("/analyze", json=body).json()
        assert len(main._RESULTS) == 1
        assert client.post("/analyze", json=body).json() == first
        assert len(main._RESULTS) == 1
        client.post("/analyze", json={**body, "side_mm": 12})
        assert len(main._RESULTS) == 2
    finally:
        os.remove(path)

def test_erase_circle_cuts_hole_and_area():
    import numpy as np
    from app.segmentation import segment
    img = np.full((200, 200, 3), 30, np.uint8)
    img[40:160, 40:160] = 200
    base = segment(img, 1.0, "g", 100, 255, 0, 1, True)
    cut = segment(img, 1.0, "g", 100, 255, 0, 1, True, erase=[[100, 100, 20]])
    assert len(cut["regions"]) == 1
    removed = base["total_area_mm2"] - cut["total_area_mm2"]
    assert abs(removed - np.pi * 20 ** 2) / (np.pi * 20 ** 2) < 0.08
    edge = segment(img, 1.0, "g", 100, 255, 0, 1, True, erase=[[40, 100, 30]])
    assert edge["total_area_mm2"] < base["total_area_mm2"] - 1000
