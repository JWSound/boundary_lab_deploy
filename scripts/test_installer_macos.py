"""Mount an unsigned DMG, copy its app, and test the installed runtime offline."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dmg", type=Path, required=True)
    parser.add_argument("--destination", type=Path, default=ROOT / "build/Mac Installed Test")
    parser.add_argument("--qualify-backends", action="store_true", help="Requires a physical Metal device")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("Run the macOS installer test on macOS")
    work = args.destination.resolve()
    if work.exists():
        parser.error("Use a new destination; existing installations are never replaced")
    work.mkdir(parents=True)
    mount = work / "Mounted Image"
    mount.mkdir()
    subprocess.run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount,
                    args.dmg.resolve()], check=True)
    try:
        apps = list(mount.glob("*.app"))
        if len(apps) != 1:
            raise RuntimeError("Expected exactly one application in the DMG")
        installed = work / apps[0].name
        subprocess.run(["/usr/bin/ditto", apps[0], installed], check=True)
    finally:
        subprocess.run(["/usr/bin/hdiutil", "detach", mount], check=True)
    data = work / "Smoke Data"
    environment = dict(os.environ)
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    environment.update(DEPLOY_SMOKE_DATA=str(data), DEPLOY_PYTHON_EXE="/not-installed/python",
                       DEPLOY_JULIA_EXE="/not-installed/julia", PYTHONPATH="/not-installed/python",
                       JULIA_PROJECT="/not-installed/julia", PATH="/usr/bin:/bin:/usr/sbin:/sbin")
    executable = installed / "Contents/MacOS/Boundary Lab Deploy"
    subprocess.run([executable, "--packaged-smoke"], cwd=work, env=environment, check=True, timeout=120)
    report = json.loads((data / "packaged-smoke.json").read_text())
    if not all(report.get(key) for key in ("packaged", "workerReady", "canvas")):
        raise RuntimeError(f"Installed application smoke test failed: {report}")
    command = [sys.executable, str(ROOT / "scripts/verify_bundle.py"), "--resources",
               str(installed / "Contents/Resources"), "--in-place", "--data-directory", str(work / "Runtime Data"),
               "--solve", "--backend", "cpu"]
    if args.qualify_backends:
        command += ["--qualify-backends", "--scene", "mixed-close-ground"]
    subprocess.run(command, check=True)
    print("Installed macOS app, bundled example, offline solver and resource integrity passed.", flush=True)


if __name__ == "__main__":
    main()
