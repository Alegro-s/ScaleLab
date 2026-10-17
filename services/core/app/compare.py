from __future__ import annotations

def compare_samples(a: dict, b: dict, tol: float = 0.005) -> dict:
    out = {"scales_match": abs(a["px_per_mm"] - b["px_per_mm"]) / max(a["px_per_mm"], b["px_per_mm"]) <= tol,
           "scale_ratio": b["px_per_mm"] / a["px_per_mm"]}
    for key in ("area_mm2", "perimeter_mm"):
        va, vb = a.get(key), b.get(key)
        if va is None or vb is None:
            out[key] = None
            continue
        d = vb - va
        out[key] = {"a": va, "b": vb, "delta": d, "delta_pct": (d / va * 100.0) if va else None}
    ar = out["area_mm2"]
    if ar and ar["delta_pct"] is not None:
        bigger = b["name"] if ar["delta"] > 0 else a["name"]
        out["verdict"] = f"{bigger} больше на {abs(ar['delta_pct']):.1f}".replace('.', ',') + ' %' if ar["delta"] != 0 else "Площади равны"
    else:
        out["verdict"] = "Недостаточно данных для сравнения"
    return out
