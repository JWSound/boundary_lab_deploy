"""Opt-in qualification of boundary/ROM solves, field reuse and warm-start sweeps."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

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
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--backend", choices=("cpu", "cuda", "both"), default="both")
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    package = Path(__file__).resolve().parents[1] / "desktop/library/S218BP_LOD.blabsp"
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

    def pressure(result):
        value = result["field_pressure"]
        return np.asarray(value["real"]) + 1j * np.asarray(value["imag"])

    results = {}
    for backend in ("cpu", "cuda") if args.backend == "both" else (args.backend,):
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
    if args.backend == "both":
        for fidelity in ("boundary", "coupled"):
            for kind in ("solve", "field", "sweep"):
                for a, b in zip(results["cpu:" + fidelity][kind], results["cuda:" + fidelity][kind]):
                    relative = np.linalg.norm(pressure(a) - pressure(b)) / max(np.linalg.norm(pressure(b)), 1e-12)
                    assert relative < 5e-4, (fidelity, kind, relative)
                    print(fidelity, kind, "CPU/CUDA relative difference", relative, flush=True)
    (args.output / "results.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
