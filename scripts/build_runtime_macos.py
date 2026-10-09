"""Stage a standalone Apple-silicon CPU/Metal runtime from pinned distributions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import sys
import tarfile
import uuid
from pathlib import Path

from build_runtime import ROOT, digest, download, run


def extract(archive: Path, destination: Path):
    # Python 3.12+ rejects escaping paths and symlinks while preserving executable modes.
    def runtime_filter(member, directory):
        # Julia's macOS tarball contains AppleDouble sidecars. ditto consumes these
        # as resource-fork metadata, so they cannot be inventoried as payload files.
        if Path(member.name).name.startswith("._") or "__MACOSX" in Path(member.name).parts:
            return None
        return tarfile.data_filter(member, directory)

    with tarfile.open(archive) as source:
        source.extractall(destination, filter=runtime_filter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build/resources")
    args = parser.parse_args()
    if sys.platform != "darwin" or platform.machine() != "arm64" or sys.version_info < (3, 12):
        parser.error("Build with native ARM64 Python 3.12+ on macOS.")
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error("Use a new, empty --output directory for each runtime build.")
    output.mkdir(parents=True, exist_ok=True)
    lock = json.loads((ROOT / "packaging/runtime-lock.json").read_text())
    target = lock["macos_arm64"]
    cache = ROOT / "build/downloads"
    cache.mkdir(parents=True, exist_ok=True)
    work = ROOT / "build/macos-staging" / uuid.uuid4().hex[:12]
    work.mkdir(parents=True)
    runtime = output / "runtime"
    runtime.mkdir()
    extract(download(target["python"], cache), runtime)
    extract(download(target["julia"], cache), work / "julia")
    julia_source = work / "julia" / f"julia-{target['julia']['version']}"
    if not (julia_source / "bin/julia").is_file():
        raise RuntimeError("Expected a Julia runtime in the pinned archive")
    shutil.copytree(julia_source, runtime / "julia", symlinks=True)
    python = runtime / "python/bin/python3"
    julia = runtime / "julia/bin/julia"
    wheels = work / "wheels"
    wheels.mkdir()
    environment = {
        key: value for key, value in os.environ.items()
        if not key.upper().startswith(("PYTHON", "JULIA", "DEPLOY_", "BLAB_", "DYLD_"))
    }
    # Download native wheels using the bundled interpreter, not the build host's ABI.
    run(python, "-I", "-m", "pip", "wheel", "--no-deps", "--wheel-dir", wheels,
        ROOT, lock["beat_requirement"], env=environment)
    run(python, "-I", "-m", "pip", "download", "--only-binary=:all:", "--dest", wheels,
        "-r", ROOT / "packaging/requirements-macos.txt", env=environment)
    run(python, "-I", "-m", "pip", "install", "--no-index", "--no-deps", "--no-compile",
        *sorted(wheels.glob("*.whl")), env=environment)
    site = runtime / "python/lib/python3.13/site-packages"
    engine = site / "beat_engine"
    # A clean staging depot prevents dependence on the maintainer's Julia installation.
    environment.update(JULIA_DEPOT_PATH=str(work / "depot"), JULIA_LOAD_PATH="@:@stdlib",
                       JULIA_CPU_TARGET="generic", JULIA_PKG_PRECOMPILE_AUTO="0")
    run(julia, "--startup-file=no", ROOT / "packaging/stage_depot.jl",
        runtime / "julia-depot", "0.0", engine / "julia_local", engine / "julia_metal", env=environment)
    shutil.copytree(ROOT / "desktop/library", output / "library", symlinks=True)
    shutil.copy2(ROOT / "LICENSE", output / "LICENSE")
    files, links = {}, {}
    for path in sorted(output.rglob("*")):
        name = path.relative_to(output).as_posix()
        if path.is_symlink():
            if not path.resolve().is_relative_to(output):
                raise RuntimeError(f"Runtime symlink escapes the bundle: {name}")
            links[name] = os.readlink(path)
        elif path.is_file():
            files[name] = digest(path)
    identity = hashlib.sha256(json.dumps([files, links], sort_keys=True).encode()).hexdigest()[:16]
    manifest = {
        "schema_version": 1, "platform": "darwin", "arch": "arm64",
        "runtime_id": "mac-arm64-" + identity, "components": lock,
        "files": files, "symlinks": links,
        "wheels": {path.name: digest(path) for path in sorted(wheels.glob("*.whl"))},
    }
    (output / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Runtime complete:", output, flush=True)


if __name__ == "__main__":
    main()
