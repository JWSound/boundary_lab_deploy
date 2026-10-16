"""Mount a DMG, copy its app, and test the installed runtime offline."""

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
    parser.add_argument("--signed", action="store_true", help="Require valid signatures and Gatekeeper acceptance")
    parser.add_argument("--verify-signatures", action="store_true", help="Verify signatures before notarization")
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
    if args.signed or args.verify_signatures:
        subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", installed], check=True)
        if args.signed:
            subprocess.run(["spctl", "--assess", "--type", "execute", "--verbose=2", installed], check=True)
        manifest = json.loads((installed / "Contents/Resources/runtime-manifest.json").read_text())
        if not manifest.get("signing", {}).get("native_files"):
            raise RuntimeError("Missing signed runtime inventory")
        for name in manifest["signing"]["native_files"]:
            subprocess.run(["codesign", "--verify", "--strict", installed / "Contents/Resources" / name], check=True)
    data = work / "Smoke Data"
    # The renderer smoke runs hidden. Its backend detection would otherwise open
    # the first-use informational dialog, which enters a native modal loop on
    # macOS. Suppress that UI only in the disposable renderer smoke profile.
    # The offline solve below uses a separate, fresh Runtime Data depot.
    manifest = json.loads((installed / "Contents/Resources/runtime-manifest.json").read_text())
    markers = data / "runtime" / manifest["runtime_id"]
    markers.mkdir(parents=True, exist_ok=True)
    for backend in ("cpu", "metal"):
        (markers / f"initialized-{backend}.json").write_text('{"rendererSmoke": true}\n')
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
    if args.qualify_backends:
        report_path = work / "Runtime Data/verification.json"
        (work / "cold-start-verification.json").write_text(report_path.read_text())
        # A second process must load the caches created by the first run without
        # prewarming dependencies or repairing/deleting any cache in between.
        print("Rechecking CPU/Metal after a warm relaunch", flush=True)
        subprocess.run(command, check=True)
        (work / "warm-start-verification.json").write_text(report_path.read_text())
    print("Installed macOS app, bundled example, offline solver and resource integrity passed.", flush=True)


if __name__ == "__main__":
    main()
