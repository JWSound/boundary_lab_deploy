"""Resolve scene package assignments and their common exported frequencies."""

from pathlib import Path
from typing import Any

import numpy as np

from boundary_deploy.assets import DeployPackageData, DeploySolveCache, _load_deploy_package_data


def scene_packages(payload: dict[str, Any], cache: DeploySolveCache | None = None) -> dict[str, DeployPackageData]:
    paths = payload.get("packagePaths")
    if paths is None:
        paths = {"": payload.get("packagePath", "")}
    elif not isinstance(paths, dict) or not paths or "" in paths:
        raise ValueError("Deploy packagePaths must be a non-empty package ID to path mapping.")
    sources = payload.get("sources", [])
    ids = list(dict.fromkeys(str(s.get("packageId", "")) for s in sources)) if "packagePaths" in payload else [""]
    if not ids:
        raise ValueError("Deploy requires at least one source.")
    packages = {}
    for package_id in ids:
        if package_id not in paths:
            raise ValueError(f"Deploy source references missing package {package_id!r}.")
        path = Path(str(paths[package_id])).expanduser().resolve()
        if path.suffix.lower() != ".blabsp":
            raise ValueError(f"Deploy requires an existing .blabsp package: {path}")
        packages[package_id] = cache.load_package(path) if cache is not None else _load_deploy_package_data(path)
    if len(packages) == 1:
        return packages
    media = [p.manifest.get("medium", {}) for p in packages.values()]
    for medium in media[1:]:
        for key, default in (("density_kg_per_m3", 1.21), ("sound_speed_m_per_s", 343.0)):
            if not np.isclose(float(medium.get(key, default)), float(media[0].get(key, default)), rtol=1e-6):
                raise ValueError("Deploy packages must use the same exterior air density and sound speed.")
    return packages


def source_package(packages: dict[str, DeployPackageData], source: dict[str, Any]) -> DeployPackageData:
    return packages[""] if "" in packages else packages[str(source.get("packageId", ""))]


ROM_REPRESENTATIONS = {"parity_petrov_galerkin_rom", "continuous_speaker_rom"}


def common_frequencies(packages, *, coupled: bool, requested=None) -> list[float]:
    """Resolve a requested sweep or a default sampling of the common scene domain."""
    if not packages:
        return []
    grids = []
    lower, upper = 0.0, np.inf
    for package in packages.values():
        if coupled:
            model = package.coupled_model
            if not model or model.get("representation") not in ROM_REPRESENTATIONS:
                raise ValueError(f"Package {package.path.name} requires a continuous or parity Petrov-Galerkin ROM.")
            if model["representation"] == "continuous_speaker_rom":
                lo, hi = model["frequency_band_hz"]
                lower, upper = max(lower, lo), min(upper, hi)
                continue
            grids.extend((package.frequencies, np.asarray(model["arrays"]["frequencies_hz"])))
        else:
            grids.append(package.frequencies)
    if requested is not None:
        if not isinstance(requested, list) or not requested:
            raise ValueError("Deploy frequenciesHz must be a non-empty array.")
        candidates = [float(v) for v in requested]
    elif grids:
        candidates = grids[0]
    else:
        candidates = [lower, upper, *(v for package in packages.values() for v in package.frequencies)]
    result = set()
    for hz in candidates:
        if grids and grids[0].size and np.isfinite(hz):
            # Recover the exported value after a Float32 or JSON round trip.
            closest = grids[0][np.argmin(np.abs(grids[0] - hz))]
            if abs(closest - hz) <= max(1e-4, hz * 1e-6):
                hz = closest
        if not np.isfinite(hz) or hz <= 0 or not lower <= hz <= upper or any(
            not np.any(np.abs(grid - hz) <= max(1e-4, hz * 1e-6)) for grid in grids
        ):
            if requested is not None:
                raise ValueError(f"Frequency {hz:g} Hz is outside the common scene frequency domain.")
            continue
        result.add(float(hz))
    return sorted(result)
