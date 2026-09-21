"""Assemble immutable Windows runtime resources; never copy a developer venv or depot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(item: dict, cache: Path) -> Path:
    path = cache / item["url"].rsplit("/", 1)[1]
    if not path.exists():
        print("Downloading", item["url"], flush=True)
        partial = path.with_suffix(path.suffix + ".partial")
        with urllib.request.urlopen(item["url"], timeout=120) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output)
        partial.replace(path)
    if digest(path) != item["sha256"]:
        raise RuntimeError(f"Checksum mismatch: {path}")
    return path


def run(*args, **kwargs):
    print("Running", *map(str, args), flush=True)
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def validate_cuda_inventory(files):
    """A worker-ready check cannot detect lazy CUDA artifacts missing on a CPU host."""
    names = {Path(name).name.lower() for name in files}
    required = ("cublas64_", "cublaslt64_", "cudart64_", "cusolver64_", "cusparse64_", "cudss64_", "nvjitlink")
    missing = [
        prefix for prefix in required if not any(name.startswith(prefix) and name.endswith(".dll") for name in names)
    ]
    if "ptxas.exe" not in names:
        missing.append("ptxas.exe")
    if missing:
        raise RuntimeError("Incomplete CUDA runtime bundle: missing " + ", ".join(missing))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build/resources")
    args = parser.parse_args()
    if sys.platform != "win32" or sys.version_info[:2] != (3, 13):
        parser.error("Build this target with 64-bit Python 3.13 on Windows.")
    lock = json.loads((ROOT / "packaging/runtime-lock.json").read_text())
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    complete = output / "runtime-manifest.json"
    if complete.exists():
        parser.error("Runtime is already complete. Use a new --output directory for a new build.")
    cache = ROOT / "build/downloads"
    cache.mkdir(parents=True, exist_ok=True)
    runtime = output / "runtime"
    python = runtime / "python"
    python.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(download(lock["python"], cache)) as archive:
        archive.extractall(python)
    julia = runtime / "julia"
    if not (julia / ".staged").exists():
        unpack = ROOT / "build/julia-unpack"
        unpack.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(download(lock["julia"], cache)) as archive:
            archive.extractall(unpack)
        shutil.copytree(unpack / f"julia-{lock['julia']['version']}", julia, dirs_exist_ok=True)
        (julia / ".staged").write_text(lock["julia"]["sha256"])

    wheels = ROOT / "build/wheels" / uuid.uuid4().hex[:12]
    wheels.mkdir(parents=True, exist_ok=True)
    run(sys.executable, "-m", "pip", "wheel", "--no-deps", "--wheel-dir", wheels, ROOT, lock["beat_requirement"])
    run(
        sys.executable,
        "-m",
        "pip",
        "download",
        "--only-binary=:all:",
        "--dest",
        wheels,
        "-r",
        ROOT / "packaging/requirements-win.txt",
    )
    site = python / "Lib/site-packages"
    run(
        sys.executable,
        "-m",
        "pip",
        "install",
        "--no-index",
        "--no-deps",
        "--no-compile",
        "--upgrade",
        "--target",
        site,
        *sorted(wheels.glob("*.whl")),
    )
    # Explicit isolated sys.path; no registry, PYTHONPATH, user site or pip at runtime.
    (python / "python313._pth").write_text("python313.zip\n.\nLib/site-packages\n", encoding="utf-8")
    engine = site / "beat_engine"
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith(("JULIA_PROJECT", "JULIA_LOAD_PATH", "JULIA_CUDA", "BLAB_"))
    }
    environment.update(JULIA_PKG_PRECOMPILE_AUTO="0", JULIA_CPU_TARGET="generic", JULIA_LOAD_PATH="@;@stdlib")
    run(
        julia / "bin/julia.exe",
        "--startup-file=no",
        ROOT / "packaging/stage_depot.jl",
        runtime / "julia-depot",
        lock["cuda_runtime"],
        engine / "julia_local",
        engine / "julia_cuda",
        env=environment,
    )
    shutil.copytree(ROOT / "desktop/library", output / "library", dirs_exist_ok=True)
    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    # Full inventory also makes installed-resource mutation detectable in relocation tests.
    files = {str(p.relative_to(output)).replace("\\", "/"): digest(p) for p in sorted(output.rglob("*")) if p.is_file()}
    validate_cuda_inventory(files)
    identity = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
    manifest = {
        "schema_version": 1,
        "runtime_id": "win-x64-" + identity,
        "components": lock,
        "files": files,
        "wheels": {p.name: digest(p) for p in sorted(wheels.glob("*.whl"))},
    }
    complete.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Runtime complete:", output, flush=True)


if __name__ == "__main__":
    main()
