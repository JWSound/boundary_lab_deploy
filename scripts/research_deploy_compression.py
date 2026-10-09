"""Replay a saved scene through the public worker; retain research inputs and outputs.

Run with PYTHONPATH pointing at the intended Deploy and BEAT src directories.
This deliberately bypasses desktop packaging and does not change the saved scene.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import beat_engine
from beat_engine import EngineWorker, engine_paths

import boundary_deploy
from boundary_deploy.assets import DeploySolveCache
from boundary_deploy.solve import prepare_deploy_field_request, prepare_deploy_rom_request


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def apply_drive_update(request):
    """Research overlay: different gain and phase on every cabinet; no file edits."""
    import cmath

    rom = request["rom"]
    models = list(rom["models"].values()) if "models" in rom else [rom]
    index = 0
    for model in models:
        node_count = max(max(orbit) for orbit in model["node_orbits"]) + 1
        face_count = max(max(orbit) for orbit in model["face_orbits"]) + 1
        for instance in model["instances"]:
            coefficient = (0.65 + 0.02 * index) * cmath.exp(0.12j * (index + 1))
            index += 1
            values = [complex(a, b) * coefficient for a, b in
                      zip(instance["input_real"], instance["input_imag"], strict=True)]
            instance["input_real"] = [v.real for v in values]
            instance["input_imag"] = [v.imag for v in values]
            for key, offset, count in (("reference_boundary_pressure", instance["node_offset"], node_count),
                                       ("boundary_neumann", instance["face_offset"], face_count)):
                trace = request.get(key)
                if isinstance(trace, dict) and "real" in trace:
                    for i in range(offset, offset + count):
                        value = complex(trace["real"][i], trace["imag"][i]) * coefficient
                        trace["real"][i], trace["imag"][i] = value.real, value.imag


def scene_payload(scene, scene_path, count, frequency, plane=None, backend="cuda"):
    if scene.get("schema") != "boundary-lab-deploy-project" or scene.get("schema_version") != 12:
        raise ValueError("Research replay currently accepts saved schema-12 Deploy scenes only.")
    if scene.get("rigid_objects"):
        raise ValueError("Rigid-object replay is not implemented by this research harness.")
    if not 1 <= count <= min(16, len(scene["sources"])):
        raise ValueError("Invalid cabinet count.")
    channels = {c["id"]: c for c in scene["channels"]}
    sources = []
    for source in scene["sources"][:count]:
        channel = channels[source["channelId"]]
        sources.append({**source,
            "levelDb": source["levelDb"] + channel["levelDb"] + scene["system_gain_db"],
            "delayMs": source["delayMs"] + channel["delayMs"],
            "polarity": source["polarity"] * channel["polarity"],
            "muted": channel["muted"], "channelEqualizer": channel["equalizer"]})
    used = {s["packageId"] for s in sources}
    packages = {}
    for package in scene["packages"]:
        if package["id"] not in used:
            continue
        path = Path(package["source_file"])
        if not path.is_absolute():
            path = scene_path.parent / path
        if not path.is_file():
            raise FileNotFoundError(path)
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != package["fingerprint"]:
            raise ValueError(f"Package fingerprint changed: {path}")
        packages[package["id"]] = str(path.resolve())
    payload = {"packagePaths": packages, "sources": sources, "rigidObjects": [],
               "frequencyHz": frequency, "backend": backend, "fidelity": "coupled",
               "includeComplexPressure": True}
    if plane is None:
        payload["observationPointsM"] = [[m["positionX"], m["positionHeightM"], m["positionZ"]]
                                         for m in scene["microphones"]]
        if not payload["observationPointsM"]:
            raise ValueError("Probe replay requires a saved microphone.")
    else:
        payload["observation"] = scene["audience_planes"][plane]
    return payload


def revision(root):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()
    return {"head": git("rev-parse", "HEAD"), "status": git("status", "--short"),
            "diff": git("diff", "--no-ext-diff")}


class GpuMonitor:
    """Device-wide sampled memory, explicitly not process-attributed or exact peak."""
    def __init__(self):
        self.stop = threading.Event()
        self.samples = []
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop.is_set():
            try:
                value = subprocess.check_output([
                    "nvidia-smi", "--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"
                ], text=True, timeout=5)
                self.samples.append([time.time(), value.strip()])
            except (OSError, subprocess.SubprocessError):
                pass
            self.stop.wait(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--counts", default="1,4,8,16")
    parser.add_argument("--frequencies", help="Exact exported frequencies; default saved selection")
    parser.add_argument("--drive-update", action="store_true", help="Apply deterministic per-instance complex drive changes")
    parser.add_argument("--modes", default="matrix_free", help="Interleaved per repeat")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--backend", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--plane", type=int)
    parser.add_argument("--field-planes", action="store_true", help="Evaluate all saved planes after the last repeat")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--compression-tolerance", type=float, default=1e-4)
    parser.add_argument("--leaf-size", type=int, default=256)
    parser.add_argument("--admissibility", type=float, default=1.0)
    parser.add_argument("--survey-only", action="store_true")
    args = parser.parse_args()
    if args.repeat < 1 or args.warmup < 0 or args.threads < 1:
        parser.error("Invalid repeat/warmup/threads")
    if not 0 < args.compression_tolerance < 1 or args.leaf_size < 8:
        parser.error("Require 0 < compression tolerance < 1 and leaf size >= 8")
    if not math.isfinite(args.admissibility) or args.admissibility <= 0:
        parser.error("Admissibility must be finite and positive")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    scene_path = args.scene.resolve()
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    counts = [int(x) for x in args.counts.split(",")]
    frequencies = ([float(x) for x in args.frequencies.split(",")] if args.frequencies
                   else [scene["selected_frequency_hz"]])
    modes = args.modes.split(",")
    if any(m not in ("auto", "matrix_free", "cached_operator", "compressed", "projected", "projected_cached", "projected_fused", "projected_reuse") for m in modes):
        parser.error("Unknown mode")
    if args.backend == "cpu" and modes != ["matrix_free"]:
        parser.error("CPU reference replay supports only matrix_free mode")
    paths = engine_paths(args.backend)
    engine_root = Path(beat_engine.__file__).resolve().parents[2]
    deploy_root = Path(boundary_deploy.__file__).resolve().parents[2]
    environment = dict(os.environ, BLAB_BEAT_ENGINE_BUNDLE="0", BLAB_BEAT_ENGINE_GPU_BACKEND=args.backend,
                       OPENBLAS_NUM_THREADS=str(args.threads), BLAS_NUM_THREADS=str(args.threads))
    metadata = {"scene_path": str(scene_path), "scene_sha256": hashlib.sha256(scene_path.read_bytes()).hexdigest(),
                "arguments": vars(args) | {"scene": str(scene_path), "output": str(output)},
                "engine": revision(engine_root), "deploy": revision(deploy_root),
                "engine_module": beat_engine.__file__, "solver": str(paths.source_solver),
                "julia_project": str(paths.project), "environment": {k: environment[k] for k in
                    ("BLAB_BEAT_ENGINE_BUNDLE", "BLAB_BEAT_ENGINE_GPU_BACKEND", "OPENBLAS_NUM_THREADS")}}
    write_json(output / "study.json", metadata)
    write_json(output / "scene.json", scene)
    snapshot = output / "source-snapshot"
    snapshot.mkdir()
    for path in (Path(__file__),
                 engine_root / "src/beat_engine/julia_local/deploy_solver.jl",
                 engine_root / "src/beat_engine/julia_local/deploy_rhs_compression.jl",
                 engine_root / "src/beat_engine/julia_local/deploy_rhs_projection.jl",
                 engine_root / "src/beat_engine/julia_local/deploy_factor_cache.jl",
                 engine_root / "src/beat_engine/julia_local/src/BeatEngineCudaBmFinalize.jl",
                 engine_root / "src/beat_engine/julia_local/src/BeatEngineCuda.jl",
                 engine_root / "src/beat_engine/julia_local/src/BeatEngineCudaRhsPacked.jl",
                 engine_root / "src/beat_engine/julia_local/src/BeatEngineCudaBurtonMiller.jl"):
        if path.is_file():
            shutil.copy2(path, snapshot / path.name)
    cache = DeploySolveCache()
    worker = EngineWorker(julia_executable="julia", solver_script=paths.source_solver,
                          julia_project=paths.project, julia_threads=str(args.threads), environment=environment)
    monitor = GpuMonitor()
    try:
        for count in counts:
            for frequency in frequencies:
                case = output / f"n{count}-f{frequency:.9g}"
                case.mkdir()
                payload = scene_payload(scene, scene_path, count, frequency, args.plane, args.backend)
                write_json(case / "payload.json", payload)
                started = time.perf_counter()
                request_path, request = prepare_deploy_rom_request(payload, case, cache=cache,
                    status_callback=lambda message: print(message, flush=True))
                prepare_s = time.perf_counter() - started
                write_json(case / "validation.json", {"status": "prepared", "prepare_s": prepare_s,
                    "frequency_hz": request["frequency_hz"], "components": request["boundary_components"]})
                if args.prepare_only:
                    continue
                base_request = copy.deepcopy(request)
                if not monitor.thread.is_alive():
                    monitor.thread.start()
                worker.ensure_started()
                write_json(output / "worker-info.json", worker.worker_info)
                for repeat in range(args.warmup + args.repeat):
                    for mode in modes:
                        label = f"{'warmup' if repeat < args.warmup else 'measured'}-{repeat}-{mode}"
                        request = copy.deepcopy(base_request)
                        if mode == "projected_reuse":
                            prime = copy.deepcopy(base_request)
                            prime["rom_feedback_mode"] = mode
                            write_json(request_path, prime)
                            write_json(case / f"{label}-prime-request.json", prime)
                            prime_result = None
                            prime_started = time.perf_counter()
                            for event in worker.submit(request_path):
                                if event.get("type") == "failed":
                                    raise RuntimeError(event.get("error", "Cache priming failed"))
                                if event.get("type") == "result":
                                    prime_result = event["result"]
                            if prime_result is None:
                                raise RuntimeError("No cache priming result")
                            write_json(case / f"{label}-prime-result.json", prime_result)
                            write_json(case / f"{label}-prime-metrics.json", {"wall_s": time.perf_counter()-prime_started})
                            print(f"PRIMED {label}", flush=True)
                        if args.drive_update:
                            apply_drive_update(request)
                        request["rom_feedback_mode"] = mode
                        request["experimental_rhs_compression"] = {
                            "tolerance": args.compression_tolerance, "leaf_size": args.leaf_size,
                            "admissibility": args.admissibility,
                            "survey_only": args.survey_only, "report_path": str(case / f"{label}-rank.json")}
                        write_json(request_path, request)
                        write_json(case / f"{label}-request.json", request)
                        print(f"START {case.name} {label}", flush=True)
                        started = time.perf_counter()
                        result = None
                        with (case / f"{label}-events.jsonl").open("w", encoding="utf-8") as log:
                            for event in worker.submit(request_path):
                                log.write(json.dumps(event) + "\n")
                                log.flush()
                                if event.get("type") == "status":
                                    print(event.get("message"), flush=True)
                                if event.get("type") == "failed":
                                    raise RuntimeError(event.get("error", "Solve failed"))
                                if event.get("type") == "result":
                                    result = event["result"]
                        if result is None:
                            raise RuntimeError("No solve result")
                        wall_s = time.perf_counter() - started
                        write_json(case / f"{label}-result.json", result)
                        write_json(case / f"{label}-metrics.json", {"wall_s": wall_s, "prepare_s": prepare_s,
                                   "timings": result.get("timings"), "diagnostics": result.get("diagnostics")})
                        print(f"DONE {label}: {wall_s:.3f}s", flush=True)
                        if args.field_planes and repeat == args.warmup + args.repeat - 1:
                            for plane_index, plane in enumerate(scene["audience_planes"]):
                                field_path, field_request = prepare_deploy_field_request({
                                    "solutionKey": request["solution_key"], "observation": plane,
                                    "backend": args.backend, "includeComplexPressure": True}, case)
                                write_json(case / f"{label}-plane{plane_index}-request.json", field_request)
                                field_started = time.perf_counter()
                                field_result = None
                                for event in worker.submit(field_path, operation="field"):
                                    if event.get("type") == "failed":
                                        raise RuntimeError(event.get("error", "Field evaluation failed"))
                                    if event.get("type") == "result":
                                        field_result = event["result"]
                                if field_result is None:
                                    raise RuntimeError("No field result")
                                write_json(case / f"{label}-plane{plane_index}-result.json", field_result)
                                print(f"FIELD {label} plane {plane_index}: {time.perf_counter()-field_started:.3f}s", flush=True)
        write_json(output / "completion.json", {"status": "complete"})
    finally:
        worker.terminate()
        monitor.stop.set()
        if monitor.thread.ident:
            monitor.thread.join(timeout=6)
        write_json(output / "gpu-memory-samples.json", {"scope": "device-wide sampled MiB, GPU percent",
                                                     "samples": monitor.samples})
        cache.close()


if __name__ == "__main__":
    main()
