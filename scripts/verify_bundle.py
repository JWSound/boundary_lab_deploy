"""Relocate packaged resources and exercise them without user Python/Julia settings."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from build_runtime import validate_cuda_inventory

ROOT = Path(__file__).resolve().parents[1]


def verify_links(destination, links):
    for name, expected in links.items():
        path = destination / name
        if not path.is_symlink() or os.readlink(path) != expected or not path.resolve().is_relative_to(destination):
            raise RuntimeError(f"Invalid bundled symlink: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, default=ROOT / "build/resources")
    parser.add_argument("--destination", type=Path, default=ROOT / "build/Relocated Deploy/resources")
    parser.add_argument("--solve", action="store_true")
    parser.add_argument("--qualify-backends", action="store_true",
                        help="Qualify CPU and the platform GPU, cached fields, and sweeps offline")
    parser.add_argument("--backend", choices=("cpu", "cuda", "metal"),
                        help="Single-solve backend; defaults to the platform GPU")
    parser.add_argument("--scene", choices=("single", "mixed-close-ground"), default="single")
    parser.add_argument("--data-directory", type=Path, help="Writable test data outside the installed resources")
    parser.add_argument("--in-place", action="store_true", help="Verify an already relocated/installed resource directory")
    args = parser.parse_args()
    destination = args.resources.resolve() if args.in_place else args.destination.resolve()
    if not args.in_place:
        if destination.exists():
            parser.error("Relocation destination must not already exist.")
        shutil.copytree(args.resources, destination, symlinks=True)
    manifest = json.loads((destination / "runtime-manifest.json").read_text())
    target = manifest.get("platform", "win32")
    if target != sys.platform or target not in {"win32", "darwin"}:
        parser.error(f"Cannot verify a {target} runtime on {sys.platform}")
    windows = target == "win32"
    if windows:
        validate_cuda_inventory(manifest["files"])
    backend = args.backend or ("cuda" if windows else "metal")
    links = manifest.get("symlinks", {})
    verify_links(destination, links)
    expected_files = dict(manifest["files"])
    # Electron adds these files around the independently staged runtime. Snapshot
    # their hashes too when qualifying resources extracted from an actual installer.
    extras = ["app.asar", "elevate.exe", "app-update.yml"]
    if not windows:
        extras += [p.relative_to(destination).as_posix() for p in destination.rglob("*")
                   if p.is_file() and (p.suffix == ".icns" and p.parent == destination or
                                      p.relative_to(destination).parts[0].endswith(".lproj"))]
    for name in extras:
        extra = destination / name
        if name not in expected_files and extra.is_file():
            with extra.open("rb") as stream:
                expected_files[name] = hashlib.file_digest(stream, "sha256").hexdigest()
    user = (args.data_directory.resolve() if args.data_directory else
            destination.parent / "Test User Data" if windows else
            ROOT / "build/verification" / uuid.uuid4().hex[:12])
    app_root = next((path for path in destination.parents if path.suffix == ".app"), destination)
    if user.is_relative_to(app_root):
        parser.error("Test data must be outside the installed resources/app bundle")
    user.mkdir(parents=True, exist_ok=True)
    temp = user / "tmp"
    temp.mkdir(exist_ok=True)
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith(("PYTHON", "JULIA", "DEPLOY_", "BLAB_", "CUDA_PATH", "CUDA_HOME", "DYLD_", "LD_LIBRARY_PATH"))}
    runtime = destination / "runtime"
    environment.update(
        PATH=str(Path(os.environ["SystemRoot"]) / "System32") if windows else "/usr/bin:/bin:/usr/sbin:/sbin",
        DEPLOY_JULIA_EXE=str(runtime / "julia/bin" / ("julia.exe" if windows else "julia")),
        JULIA_DEPOT_PATH=os.pathsep.join([str(user / 'julia-depot'), str(runtime / 'julia-depot'), ""]),
        JULIA_LOAD_PATH=os.pathsep.join(["@", "@stdlib"]), JULIA_PKG_OFFLINE="true", JULIA_PKG_PRECOMPILE_AUTO="0",
        JULIA_NUM_PRECOMPILE_TASKS="2", JULIA_CPU_TARGET="generic", TEMP=str(temp), TMP=str(temp), TMPDIR=str(temp),
        HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", ALL_PROXY="http://127.0.0.1:9",
        NO_PROXY="", JULIA_PKG_SERVER="",
    )
    python = runtime / ("python/python.exe" if windows else "python/bin/python3")
    result = subprocess.run([python, "-I", "-B", "-X", "utf8", "-m", "boundary_deploy.worker"], env=environment, cwd=user,
                            input='', capture_output=True, text=True, timeout=60, check=True)
    assert json.loads(result.stdout.splitlines()[0])["type"] == "ready", result.stdout
    if args.solve:
        subprocess.run([python, "-I", "-B", "-X", "utf8", ROOT / "scripts/smoke_solver.py", "--library", destination / "library",
                        "--backend", backend, "--output", user / ("solve-" + uuid.uuid4().hex[:8])],
                       env=environment, cwd=user, check=True, timeout=900)
    if args.qualify_backends:
        subprocess.run([python, "-I", "-B", "-X", "utf8", ROOT / "scripts/check_solver_backends.py",
                        "--library", destination / "library", "--backend", "both" if windows else "cpu-metal",
                        "--scene", args.scene,
                        "--output", user / ("backends-" + uuid.uuid4().hex[:8])],
                       env=environment, cwd=user, check=True, timeout=1800)
    for name, expected in expected_files.items():
        with (destination / name).open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError(f"Installed resource was modified: {name}")
    verify_links(destination, links)
    unexpected = {str(p.relative_to(destination)).replace("\\", "/") for p in destination.rglob("*") if p.is_file() or p.is_symlink()} - set(expected_files) - set(links) - {"runtime-manifest.json"}
    if unexpected:
        raise RuntimeError(f"Runtime created files in its installation: {sorted(unexpected)[:10]}")
    report = {"worker_ready": True, "solve": args.solve, "qualified_backends": args.qualify_backends, "resources_unchanged": True,
              "destination": str(destination), "runtime_id": manifest["runtime_id"]}
    (user / "verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
