"""Summarize paired research runs, with complex-output and convergence gates."""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

import numpy as np


def complex_values(value):
    if isinstance(value, list):
        return np.concatenate([complex_values(item) for item in value])
    return np.asarray(value["real"], dtype=float) + 1j * np.asarray(value["imag"], dtype=float)


def pressure_error(reference, candidate):
    if any(reference[k] != candidate[k] for k in ("sample_indices", "rows", "columns")):
        raise ValueError("Incompatible audience-plane sampling")
    a, b = complex_values(reference["field_pressure"]), complex_values(candidate["field_pressure"])
    if a.shape != b.shape or not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)):
        raise ValueError("Invalid plane pressure")
    relative = float(np.linalg.norm(a-b) / max(np.linalg.norm(a), np.finfo(float).tiny))
    mask = (np.abs(a) >= np.max(np.abs(a)) * 10**(-30/20)) & (np.abs(a) > 0)
    maximum_db = float(np.max(np.abs(20*np.log10(np.maximum(np.abs(b[mask]), np.finfo(float).tiny)
                                               / np.abs(a[mask]))))) if np.any(mask) else 0.0
    return {"samples": int(a.size), "relative_l2": relative, "max_db_within_30db_of_peak": maximum_db,
            "passed": relative < 0.01 and maximum_db < 0.1}


def compare(reference, candidate):
    if any(reference[k] != candidate[k] for k in ("frequency_hz", "sample_indices", "rows", "columns")):
        raise ValueError("Incompatible output sampling")
    for key in ("phasor_convention", "node_count", "face_count"):
        if reference["diagnostics"].get(key) != candidate["diagnostics"].get(key):
            raise ValueError(f"Incompatible {key}")
    output = {}
    for name in ("field_pressure", "transducer_velocity", "transducer_current"):
        left = reference if name == "field_pressure" else reference["diagnostics"]
        right = candidate if name == "field_pressure" else candidate["diagnostics"]
        a, b = complex_values(left[name]), complex_values(right[name])
        if a.shape != b.shape or not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)):
            raise ValueError(f"Invalid {name}")
        error = np.linalg.norm(a-b) / max(np.linalg.norm(a), np.finfo(float).tiny)
        mask = np.abs(a) >= np.max(np.abs(a)) * 10**(-30/20)
        mask &= np.abs(a) > 0
        db_error = float(np.max(np.abs(20*np.log10(np.maximum(np.abs(b[mask]), np.finfo(float).tiny)
                                                    / np.abs(a[mask]))))) if np.any(mask) else 0.0
        output[name] = {"relative_l2": float(error), "max_db_within_30db_of_peak": db_error}
    residual = float(candidate["diagnostics"]["schur_gmres_relative_residual"])
    compression = candidate["diagnostics"].get("rhs_compression") or {}
    exact_residual = compression.get("exact_preconditioned_relative_residual")
    if exact_residual is None:
        raise ValueError("Compressed solve lacks an independent exact-operator residual audit")
    output["passed"] = bool(all(v["relative_l2"] < 0.01 and v["max_db_within_30db_of_peak"] < 0.1
                                  for v in output.values()) and residual <= 1e-4 and exact_residual <= 1e-3
                            and float(reference["diagnostics"]["schur_gmres_relative_residual"]) <= 1e-4)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("study", type=Path)
    parser.add_argument("--candidate", choices=("compressed", "projected", "projected_cached", "projected_fused", "projected_reuse"), default="compressed")
    parser.add_argument("--reference", default="matrix_free")
    args = parser.parse_args()
    if json.loads((args.study / "completion.json").read_text()).get("status") != "complete":
        raise ValueError("Refusing to compare an incomplete study")
    results = {}
    for case in sorted(args.study.glob("n*-f*")):
        groups = {mode: sorted(case.glob(f"measured-*-{mode}-metrics.json"))
                  for mode in (args.reference, args.candidate)}
        if not all(groups.values()):
            continue
        if len(groups[args.reference]) != len(groups[args.candidate]):
            raise ValueError(f"Unpaired measured runs in {case}")
        summary = {}
        for mode, paths in groups.items():
            values = [json.loads(p.read_text()) for p in paths]
            times = [v["wall_s"] for v in values]
            summary[mode] = {"runs": len(times), "wall_median_s": statistics.median(times),
                             "wall_range_s": [min(times), max(times)],
                             "median_sections_s": {k: statistics.median(v["timings"][k] for v in values)
                                                   for k in values[0]["timings"]}}
        comparisons = []
        for path in groups[args.candidate]:
            reference_path = path.with_name(path.name.replace(f"{args.candidate}-metrics", f"{args.reference}-result"))
            candidate_path = path.with_name(path.name.replace("-metrics", "-result"))
            comparisons.append(compare(json.loads(reference_path.read_text()), json.loads(candidate_path.read_text())))
        summary["comparisons"] = comparisons
        planes = {}
        for path in sorted(case.glob(f"measured-*-{args.candidate}-plane*-result.json")):
            reference_path = path.with_name(path.name.replace(f"-{args.candidate}-", f"-{args.reference}-"))
            planes[path.name] = pressure_error(json.loads(reference_path.read_text()), json.loads(path.read_text()))
        summary["planes"] = planes
        summary["passed"] = all(x["passed"] for x in comparisons) and all(x["passed"] for x in planes.values())
        summary["speedup"] = summary[args.reference]["wall_median_s"] / summary[args.candidate]["wall_median_s"]
        results[case.name] = summary
    if not results:
        raise ValueError("No paired measured cases")
    (args.study / "comparison.json").write_text(json.dumps(results, indent=2, allow_nan=False))
    print(json.dumps(results, indent=2, allow_nan=False))
    return 0 if all(case["passed"] for case in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
