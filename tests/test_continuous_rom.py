import base64
import hashlib
import json
import zipfile
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from boundary_deploy.assets import DeploySolveCache
from boundary_deploy.packages import common_frequencies, scene_packages
from boundary_deploy.solve import prepare_deploy_rom_microphone_sweep_request, prepare_deploy_rom_request

LEGACY = Path(__file__).parent / "fixtures/speaker-packages/rom-x.blabsp"


def matrix(values):
    values = np.asarray(values, dtype="<f8")
    return {
        "shape": list(values.shape),
        "base64": base64.b64encode(values.tobytes(order="F")).decode(),
        "storage": "f64le-column-major",
    }


@pytest.fixture
def scene(tmp_path):
    cache = DeploySolveCache()
    legacy = cache.load_package(LEGACY)
    manifest = dict(legacy.manifest)
    driver = dict(
        id="test",
        rms_n_s_per_m=1,
        mmd_kg=0.1,
        cms_m_per_n=0.01,
        re_ohm=4,
        le_h=0.001,
        bl_n_per_a=3,
        semi_inductance=None,
        lumped_sealed_rear_chamber=None,
    )
    matrices = dict(
        K=[[3, 1], [1, 2]],
        M=np.eye(2) * 0.01,
        loss=np.eye(2) * 0.001,
        surface=[[0], [1]],
        force=[[0], [1]],
        drive=[[1, 0.5]],
        gram=[[0.5]],
        bem_force=np.zeros((4, 1)),
        bem_velocity=np.zeros((2, 1)),
        flux=[[0], [2]],
        trace=[[0, 1, 0, 0]],
    )
    model = dict(
        metadata={"format": "continuous-speaker-v1", "phasor": "exp(+i omega t)"},
        ports=manifest["excitation_port_ids"],
        drivers=[driver],
        band=[40, 700],
        c=343,
        rho=1.21,
        walls=[],
        matrices={k: matrix(v) for k, v in matrices.items()},
        geometry={"points": legacy.points.tolist(), "triangles": legacy.triangles.tolist()},
    )
    declaration = dict(
        format_version=1, frequency_band_hz=model["band"], path="interior.json", representation="continuous_speaker_rom"
    )
    manifest["files"] = {**manifest["files"], "coupled_model": declaration}
    with zipfile.ZipFile(LEGACY) as archive:
        members = {name: archive.read(name) for name in archive.namelist() if name != "checksums.json"}
    members.update({"interior.json": json.dumps(model).encode(), "manifest.json": json.dumps(manifest).encode()})
    members["checksums.json"] = json.dumps({k: hashlib.sha256(v).hexdigest() for k, v in members.items()}).encode()
    path = tmp_path / "continuous.blabsp"
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    payload = dict(
        packagePath=str(path),
        sources=[dict(id="a", positionHeightM=2)],
        frequencyHz=162.5,
        observationPointsM=[[0, 2, 4]],
        backend="cpu",
    )
    try:
        yield payload, cache
    finally:
        cache.close()


def test_off_grid_pressure_and_voltage_response(scene, tmp_path):
    payload, cache = scene
    _, req = prepare_deploy_rom_request({**payload, "_nativeContinuousROM": False}, tmp_path, cache=cache)
    assert req["frequency_hz"] == 162.5
    rom = req["rom"]
    assert rom["node_orbits"] == [[1]] and rom["face_orbits"] == [[1]]
    arrays = {
        k: np.fromfile(d["file"], dtype="<c8", offset=d["offset"], count=d["nbytes"] // 8).reshape(d["shape"])[0]
        for k, d in rom["binary_arrays"].items()
    }
    # Two independent loads: exterior pressure with both ports silent, and voltage only.
    p = np.array([[2 + 1j, 0]])
    u = np.array([[0, 1], [0, 2j]])
    x = np.linalg.solve(arrays["k"], arrays["b"] @ u - arrays["c"] @ p)
    s = 2j * np.pi * 162.5
    k2 = (s.imag / 343) ** 2
    a11, a22 = 3 - k2 * (0.01 - 0.001j), 2 - k2 * (0.01 - 0.001j)
    scale = -1.21 * s
    zm, ze = 1 + s * 0.1 + 100 / s, 4 + s * 0.001
    velocity = (3 * (u[0] + 0.5 * u[1]) / ze - p[0] / a22) / (zm + 9 / ze - scale / a22)
    interior = (scale * velocity - p[0]) / a22
    np.testing.assert_allclose(arrays["d"] @ x, 4 * (a11 * p + interior), rtol=2e-6)
    np.testing.assert_allclose(arrays["velocity"] @ x, velocity[None], rtol=2e-6)
    np.testing.assert_allclose(arrays["current"] @ x, ((u[0] + 0.5 * u[1] - 3 * velocity) / ze)[None], rtol=2e-6)


def test_scene_domain_and_sweep_staging(scene, tmp_path):
    payload, cache = scene
    packages = scene_packages(payload, cache)
    assert common_frequencies(packages, coupled=False) == [100, 1000]
    for grid in ([40, 162.5, 700], [100.5, 163, 210]):
        _, req = prepare_deploy_rom_microphone_sweep_request({**payload, "frequenciesHz": grid}, tmp_path, cache=cache)
        assert req["rom_sweep"]["representation"] == "continuous_speaker_rom"
        assert req["rom_sweep"]["compact_model"]["package"] == payload["packagePath"]
        assert all("binary_arrays" not in e for e in req["rom_sweep"]["frequencies"])
        assert req["provenance"]["rom_sweep_stage_binary_bytes_written"] == 0
        assert not list(tmp_path.glob("*.bin"))
        assert packages[""].coupled_model["interior"].matrices is None
        assert req["frequencies_hz"] == grid
        assert req["provenance"]["rom_sweep_stage_cache_hit"] == 0
    with pytest.raises(ValueError, match="frequency domain"):
        prepare_deploy_rom_request({**payload, "frequencyHz": 701}, tmp_path, cache=cache)
    payload["packagePaths"] = {"new": payload.pop("packagePath"), "old": str(LEGACY)}
    payload["sources"] = [
        dict(id=k, packageId=k, positionX=i * 3, positionHeightM=2) for i, k in enumerate(("old", "new"))
    ]
    assert common_frequencies(scene_packages(payload, cache), coupled=True) == [100]
    _, req = prepare_deploy_rom_microphone_sweep_request(payload, tmp_path, cache=cache)
    assert req["frequencies_hz"] == [100]
    assert set(req["rom_sweep"]["models"]) == {"old", "new"}
    with pytest.raises(ValueError, match="frequency domain"):
        prepare_deploy_rom_microphone_sweep_request({**payload, "frequenciesHz": [100, 162.5]}, tmp_path, cache=cache)


def test_continuous_overlap_and_disjoint_bands(scene):
    payload, cache = scene
    first = scene_packages(payload, cache)[""]
    other = replace(first, coupled_model={**first.coupled_model, "frequency_band_hz": [200, 800]})
    packages = {"first": first, "other": other}
    assert common_frequencies(packages, coupled=True) == [200, 700]
    assert common_frequencies(packages, coupled=True, requested=[242.375]) == [242.375]
    disjoint = replace(other, coupled_model={**other.coupled_model, "frequency_band_hz": [800, 900]})
    assert common_frequencies({"first": first, "other": disjoint}, coupled=True) == []
