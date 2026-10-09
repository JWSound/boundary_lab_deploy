"""Opt-in qualification of boundary/ROM solves, field reuse and warm-start sweeps."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import sys
from pathlib import Path

import numpy as np
from beat_engine import engine_paths

from boundary_deploy.assets import DeploySolveCache
from boundary_deploy.packages import common_frequencies, scene_packages
from boundary_deploy.solve import (
    prepare_deploy_field_request,
    prepare_deploy_microphone_sweep_request,
    prepare_deploy_rom_microphone_sweep_request,
    prepare_deploy_rom_request,
    prepare_deploy_solve_request,
)
from boundary_deploy.worker import _worker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=Path(__file__).resolve().parents[1] / "desktop/library")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--backend", choices=("cpu", "cuda", "metal", "both", "cpu-metal"), default="both")
    parser.add_argument("--scene", choices=("single", "mixed-close-ground"), default="single")
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    package = args.library.resolve() / "S218BP_LOD.blabsp"
    payload = {
        "packagePath": str(package),
        "includeComplexPressure": True,
        "sources": [
            {
                "id": "speaker",
                "positionX": 0,
                "positionHeightM": 1,
                "positionZ": 0,
                "yawDeg": 0,
                "levelDb": 0,
                "delayMs": 0,
                "polarity": 1,
            }
        ],
        "observationPointsM": [[0, 1.2, 5], [3, 1.2, 8]],
        "observation": {"widthM": 2, "depthM": 2, "heightM": 1.2, "centerXM": 0, "nearM": 4, "rows": 2, "columns": 2},
    }
    if args.scene == "mixed-close-ground":
        cache = DeploySolveCache()
        try:
            other = args.library.resolve() / "SKHORN.blabsp"
            first, second = cache.load_package(package), cache.load_package(other)
            source = payload["sources"][0]
            # Package +Z maps to scene -Y. Keep both bottoms 5 mm above
            # ground and opposing cabinet sides 25 mm apart (20 mm padding).
            payload.pop("packagePath")
            payload["packagePaths"] = {"a": str(package), "b": str(other)}
            payload["sources"] = [
                {**source, "id": "a", "packageId": "a",
                 "positionX": -0.0125 - float(first.points[:, 0].max()),
                 "positionHeightM": 0.005 + float(first.points[:, 2].max())},
                {**source, "id": "b", "packageId": "b", "delayMs": 0.7, "levelDb": -3,
                 "positionX": 0.0125 - float(second.points[:, 0].min()),
                 "positionHeightM": 0.005 + float(second.points[:, 2].max())},
            ]
        finally:
            cache.close()
    (args.output / "payload.json").write_text(json.dumps(payload, indent=2))
    engine_root = engine_paths().root
    provenance = {
        "engine_version": importlib.metadata.version("beat-engine"),
        "deploy_version": importlib.metadata.version("boundary-lab-deploy"),
        "python": sys.version, "platform": platform.platform(), "scene": args.scene,
        "engine_files_sha256": {
            path.relative_to(engine_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(engine_root.rglob("*")) if path.suffix in {".jl", ".toml", ".json", ".py"}
        },
    }
    (args.output / "provenance.json").write_text(json.dumps(provenance, indent=2))

    def pressure(result):
        value = result["field_pressure"]
        return np.asarray(value["real"]) + 1j * np.asarray(value["imag"])

    results = {}
    backends = {"both": ("cpu", "cuda"), "cpu-metal": ("cpu", "metal")}.get(args.backend, (args.backend,))
    for backend in backends:
        worker = _worker(backend)
        cache = DeploySolveCache()
        try:
            packages = scene_packages(payload, cache)
            frequencies = common_frequencies(packages, coupled=True)
            index = len(frequencies) // 2
            frequencies = frequencies[index : index + 2]
            for fidelity in ("boundary", "coupled"):
                directory = args.output / backend / fidelity
                directory.mkdir(parents=True)

                def submit(path, operation, label):
                    values = []
                    with (directory / (label + "-events.jsonl")).open("w") as stream:
                        for event in worker.submit(path, operation=operation):
                            stream.write(json.dumps(event) + "\n")
                            if event.get("type") in ("failed", "error"):
                                raise RuntimeError(event)
                            if event.get("type") == "result":
                                value = event["result"]
                                assert np.isfinite(pressure(value)).all()
                                values.append(value)
                    assert values, "No result"
                    return values

                case = {
                    **payload,
                    "backend": backend,
                    "fidelity": fidelity,
                    "frequencyHz": float(frequencies[0]),
                    "solutionKey": "qualification",
                }
                prepare = prepare_deploy_rom_request if fidelity == "coupled" else prepare_deploy_solve_request
                path, _ = prepare(case, directory / "solve", cache=cache)
                solved = submit(path, "solve", "solve")
                if args.scene == "mixed-close-ground":
                    assert solved[0]["diagnostics"]["near_face_pair_count"] > 0
                    assert solved[0]["diagnostics"]["ground_image_near_face_pair_count"] > 0
                field_case = {**case, "observation": payload["observation"]}
                path, _ = prepare_deploy_field_request(field_case, directory / "field")
                fields = submit(path, "field", "field")
                assert fields[0]["diagnostics"]["field_only"]
                prepare_sweep = (
                    prepare_deploy_rom_microphone_sweep_request
                    if fidelity == "coupled"
                    else prepare_deploy_microphone_sweep_request
                )
                path, _ = prepare_sweep(
                    {**case, "frequenciesHz": [float(f) for f in frequencies]}, directory / "sweep", cache=cache
                )
                # Boundary sweeps intentionally include every package frequency;
                # trim their serialized arrays for this bounded qualification.
                if fidelity == "boundary":
                    request = json.loads(path.read_text())
                    indices = [
                        i
                        for i, f in enumerate(request["frequencies_hz"])
                        if any(abs(f - float(wanted)) < 1e-4 for wanted in frequencies)
                    ]
                    request["frequencies_hz"] = [request["frequencies_hz"][i] for i in indices]
                    for key in ("boundary_neumann_sweep", "reference_boundary_pressure_sweep"):
                        for part in ("real", "imag"):
                            request[key][part] = [request[key][part][i] for i in indices]
                    path.write_text(json.dumps(request))
                sweep = submit(path, "solve", "sweep")
                assert len(sweep) == 2
                assert np.allclose(pressure(solved[0]), pressure(sweep[0]), rtol=5e-4, atol=1e-6)
                if fidelity == "coupled":
                    assert sweep[1]["diagnostics"]["schur_gmres_warm_started"]
                    assert all(v["diagnostics"]["schur_gmres_relative_residual"] <= 1e-4 for v in sweep)
                results[backend + ":" + fidelity] = {"solve": solved, "field": fields, "sweep": sweep}
                print(backend, fidelity, "passed", flush=True)
        finally:
            worker.terminate()
            cache.close()
    if len(backends) == 2:
        accelerator = backends[1]
        for fidelity in ("boundary", "coupled"):
            for kind in ("solve", "field", "sweep"):
                for a, b in zip(results["cpu:" + fidelity][kind], results[accelerator + ":" + fidelity][kind], strict=True):
                    assert pressure(a).shape == pressure(b).shape
                    relative = np.linalg.norm(pressure(a) - pressure(b)) / max(np.linalg.norm(pressure(b)), 1e-12)
                    assert relative < 5e-4, (fidelity, kind, relative)
                    print(fidelity, kind, f"CPU/{accelerator.upper()} relative difference", relative, flush=True)
                    if fidelity == "coupled" and kind != "field":
                        for quantity in ("transducer_velocity", "transducer_current"):
                            for av, bv in zip(a["diagnostics"][quantity], b["diagnostics"][quantity], strict=True):
                                first = np.asarray(av["real"]) + 1j * np.asarray(av["imag"])
                                second = np.asarray(bv["real"]) + 1j * np.asarray(bv["imag"])
                                assert first.shape == second.shape
                                assert np.isfinite(first).all() and np.isfinite(second).all()
                                assert np.linalg.norm(first - second) <= 5e-4 * np.linalg.norm(second) + 1e-8, quantity
    (args.output / "results.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
