"""Relocate packaged resources and exercise them without user Python/Julia settings."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, default=ROOT / "build/resources")
    parser.add_argument("--destination", type=Path, default=ROOT / "build/Relocated Deploy/resources")
    parser.add_argument("--solve", action="store_true")
    parser.add_argument("--in-place", action="store_true", help="Verify an already relocated/installed resource directory")
    args = parser.parse_args()
    destination = args.resources.resolve() if args.in_place else args.destination.resolve()
    if not args.in_place:
        if destination.exists():
            parser.error("Relocation destination must not already exist.")
        shutil.copytree(args.resources, destination)
    manifest = json.loads((destination / "runtime-manifest.json").read_text())
    user = destination.parent / "Test User Data"
    user.mkdir(exist_ok=True)
    temp = user / "tmp"
    temp.mkdir(exist_ok=True)
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith(("PYTHON", "JULIA", "DEPLOY_", "BLAB_", "CUDA_PATH", "CUDA_HOME"))}
    runtime = destination / "runtime"
    environment.update(
        PATH=str(Path(os.environ["SystemRoot"]) / "System32"),
        DEPLOY_JULIA_EXE=str(runtime / "julia/bin/julia.exe"),
        JULIA_DEPOT_PATH=f"{user / 'julia-depot'};{runtime / 'julia-depot'};",
        JULIA_LOAD_PATH="@;@stdlib", JULIA_PKG_OFFLINE="true", JULIA_PKG_PRECOMPILE_AUTO="0",
        JULIA_NUM_PRECOMPILE_TASKS="2", JULIA_CPU_TARGET="generic", TEMP=str(temp), TMP=str(temp),
        HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", ALL_PROXY="http://127.0.0.1:9",
        NO_PROXY="", JULIA_PKG_SERVER="",
    )
    python = runtime / "python/python.exe"
    result = subprocess.run([python, "-I", "-B", "-X", "utf8", "-m", "boundary_deploy.worker"], env=environment, cwd=user,
                            input='', capture_output=True, text=True, timeout=60, check=True)
    assert json.loads(result.stdout.splitlines()[0])["type"] == "ready", result.stdout
    if args.solve:
        subprocess.run([python, "-I", "-B", "-X", "utf8", ROOT / "scripts/smoke_solver.py", "--library", destination / "library",
                        "--output", user / ("solve-" + uuid.uuid4().hex[:8])], env=environment, cwd=user, check=True, timeout=900)
    for name, expected in manifest["files"].items():
        with (destination / name).open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError(f"Installed resource was modified: {name}")
    unexpected = {str(p.relative_to(destination)).replace("\\", "/") for p in destination.rglob("*") if p.is_file()} - set(manifest["files"]) - {"runtime-manifest.json"}
    if unexpected:
        raise RuntimeError(f"Runtime created files in its installation: {sorted(unexpected)[:10]}")
    report = {"worker_ready": True, "solve": args.solve, "resources_unchanged": True,
              "destination": str(destination), "runtime_id": manifest["runtime_id"]}
    (user / "verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
