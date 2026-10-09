"""Create controlled accuracy cases from a two-package schema-12 Deploy scene.

Generated scenes are research fixtures, not additional saved customer projects.
The first source's package is primary; the other package is secondary.
Replay matrix.json cases with research_deploy_compression.py, using its listed
frequencies and matrix_free,projected_fused,projected_reuse modes.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import zipfile
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.scene.resolve()
    scene = json.loads(source.read_text(encoding="utf-8"))
    if scene.get("schema_version") != 12 or len(scene["sources"]) < 8:
        raise ValueError("Require a schema-12 scene with at least eight primary sources")
    primary = scene["sources"][0]["packageId"]
    if any(s["packageId"] != primary for s in scene["sources"][:8]):
        raise ValueError("The first eight sources must share the primary package")
    secondary, = [p["id"] for p in scene["packages"] if p["id"] != primary]
    grids = []
    for package in scene["packages"]:
        path = Path(package["source_file"])
        if not path.is_absolute():
            path = source.parent / path
        if hashlib.sha256(path.read_bytes()).hexdigest() != package["fingerprint"]:
            raise ValueError(f"Package fingerprint changed: {path}")
        package["source_file"] = str(path.resolve())
        with zipfile.ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            model = manifest["files"]["coupled_model"]
            with np.load(io.BytesIO(archive.read(model["path"]))) as arrays:
                grids.append(set(map(float, arrays["frequencies_hz"])))
    common = sorted(set.intersection(*grids))
    if len(common) < 3:
        raise ValueError("Require at least three common exported frequencies")
    frequencies = sorted({common[0], min(common, key=lambda f: abs(f-100)), common[-1]})
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    cases = []
    for name in ("primary-8-stack", "secondary-4-spaced", "mixed-4-rotated"):
        derived = copy.deepcopy(scene)
        derived["name"] = "Derived qualification: " + name
        derived["sources"] = derived["sources"][:8 if name.startswith("primary") else 4]
        if not name.startswith("primary"):
            for i, item in enumerate(derived["sources"]):
                item.update(positionX=(i % 2)*4-2, positionZ=(i//2)*4-2,
                            positionHeightM=2.0, pitchDeg=0, yawDeg=i*45, rollDeg=0)
                item["packageId"] = secondary if name.startswith("secondary") or i % 2 == 0 else primary
                if name.startswith("mixed"):
                    item.update(pitchDeg=(-1)**i*10, rollDeg=(-1)**i*20, positionHeightM=2.0+i*.25)
        for plane in derived["audience_planes"]:
            plane.update(columns=31, rows=31, pointsPerMeter=1)
        derived["microphones"] = [
            dict(derived["microphones"][0], id=f"qualification-probe-{i}",
                 positionX=x, positionHeightM=h, positionZ=z)
            for i, (x, h, z) in enumerate([(0, 1, 8), (5, 2, 5), (-5, 3, 3), (1, 6, -5), (8, .5, -2)])]
        path = output / (name + ".blabdeploy.json")
        path.write_text(json.dumps(derived, indent=2), encoding="utf-8")
        cases.append({"name": name, "scene": str(path), "count": len(derived["sources"])})
    (output / "matrix.json").write_text(json.dumps({
        "source": str(source), "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "frequencies": frequencies, "kind": "controlled derived scenes; accuracy-only",
        "cases": cases}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
