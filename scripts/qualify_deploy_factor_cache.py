"""Check real-worker factor hits and geometry/frequency invalidation on one cabinet."""
from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
from pathlib import Path

from beat_engine import EngineWorker, engine_paths
from compare_deploy_compression import compare
from research_deploy_compression import apply_drive_update, scene_payload, write_json

from boundary_deploy.assets import DeploySolveCache
from boundary_deploy.solve import prepare_deploy_rom_request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frequency", type=float, required=True)
    parser.add_argument("--next-frequency", type=float, required=True)
    parser.add_argument("--cpu-result", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    shutil.copy2(__file__, output / Path(__file__).name)
    scene_path = args.scene.resolve()
    original = json.loads(scene_path.read_text(encoding="utf-8"))
    moved = copy.deepcopy(original)
    moved["sources"][0]["positionX"] += .375
    moved["sources"][0]["yawDeg"] += 17
    paths = engine_paths("cuda")
    worker = EngineWorker(julia_executable="julia", solver_script=paths.source_solver,
                          julia_project=paths.project, julia_threads="4", environment=dict(
                              os.environ, BLAB_BEAT_ENGINE_BUNDLE="0", BLAB_BEAT_ENGINE_GPU_BACKEND="cuda",
                              OPENBLAS_NUM_THREADS="4", BLAS_NUM_THREADS="4"))
    cache = DeploySolveCache()
    requests, results = {}, {}

    def solve(label, case, mode, update=True):
        request = copy.deepcopy(requests[case])
        if update:
            apply_drive_update(request)
        request["rom_feedback_mode"] = mode
        path = output / (label + "-request.json")
        write_json(path, request)
        result = None
        with (output / (label + "-events.jsonl")).open("w", encoding="utf-8") as log:
            for event in worker.submit(path):
                log.write(json.dumps(event) + "\n")
                log.flush()
                if event.get("type") == "failed":
                    raise RuntimeError(event.get("error", "Solve failed"))
                if event.get("type") == "result":
                    result = event["result"]
        if result is None:
            raise RuntimeError("Worker returned no result")
        write_json(output / (label + "-result.json"), result)
        results[label] = result
        print(label, (result["diagnostics"].get("rhs_compression") or {}).get("factor_cache_hit"), flush=True)

    try:
        for name, scene, frequency in (("a", original, args.frequency), ("b", moved, args.frequency),
                                       ("c", moved, args.next_frequency)):
            folder = output / name
            folder.mkdir()
            payload = scene_payload(scene, scene_path, 1, frequency)
            write_json(folder / "payload.json", payload)
            _, requests[name] = prepare_deploy_rom_request(payload, folder, cache=cache)
        worker.ensure_started()
        write_json(output / "worker-info.json", worker.worker_info)
        solve("a-reference", "a", "matrix_free")
        solve("a-prime", "a", "projected_reuse", update=False)
        solve("a-hit", "a", "projected_reuse")
        for case in ("b", "c"):
            solve(case + "-miss", case, "projected_reuse")
            solve(case + "-hit", case, "projected_reuse")
        for case in ("b", "c"):
            solve(case + "-reference", case, "matrix_free")
        reports = {name: result["diagnostics"].get("rhs_compression") for name, result in results.items()}
        for label in ("a-prime", "b-miss", "c-miss"):
            assert reports[label]["factor_cache_hit"] is False, label
        for case in ("a", "b", "c"):
            assert reports[case + "-hit"]["factor_cache_hit"] is True, case
            first = case + ("-prime" if case == "a" else "-miss")
            assert reports[first]["factor_signature"] == reports[case + "-hit"]["factor_signature"]
        assert len({reports[c + "-hit"]["factor_signature"] for c in ("a", "b", "c")}) == 3
        comparisons = {c: compare(results[c + "-reference"], results[c + "-hit"]) for c in ("a", "b", "c")}
        if args.cpu_result:
            comparisons["cpu"] = compare(json.loads(args.cpu_result.read_text()), results["a-hit"])
        write_json(output / "comparisons.json", comparisons)
        if not all(c["passed"] for c in comparisons.values()):
            raise RuntimeError("Factor lifecycle accuracy gate failed")
        write_json(output / "completion.json", {"status": "complete", "cache_checks": "passed"})
    finally:
        worker.terminate()
        cache.close()


if __name__ == "__main__":
    main()
