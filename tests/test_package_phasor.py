"""Legacy and current speaker packages normalize complex data exactly once."""

import hashlib
import io
import json
import zipfile

import numpy as np
import pytest

from boundary_deploy.assets import _load_deploy_package_data
from boundary_deploy.phasor import LEGACY_PHASOR_CONVENTION as MINUS
from boundary_deploy.phasor import SOLVER_PHASOR_CONVENTION as PLUS
from boundary_deploy.phasor import convert_phasor


def npz(**arrays):
    output = io.BytesIO()
    np.savez(output, **arrays)
    return output.getvalue()


@pytest.mark.parametrize("convention", [MINUS, PLUS, None])
def test_old_and_new_package_traces_and_rom_normalize_once(tmp_path, convention):
    value = np.array([1 + 2j, 3 - 4j], dtype=np.complex64)
    manifest = {
        "schema": "boundary-lab-speaker-package",
        "schema_version": 1,
        "frequencies_hz": [100.0],
        "files": {
            "fixed_sources": {"path": "fixed.npz", "geometry_mesh": "mesh.msh"},
            "coupled_model": {"path": "rom.npz", "representation": "parity_petrov_galerkin_rom"},
        },
    }
    if convention is not None:
        manifest["phasor_convention"] = convention
    names = ("k", "c", "d", "b", "e", "velocity", "current", "velocity_drive", "current_drive")
    members = {
        "manifest.json": json.dumps(manifest).encode(),
        "mesh.msh": b"geometry",
        "fixed.npz": npz(
            triangles=np.array([[0, 1, 2]]), points_m=np.eye(3), pressure_pa=value, normal_derivative_pa_per_m=2 * value
        ),
        "rom.npz": npz(frequencies_hz=np.array([100.0]), **{name: value for name in names}),
    }
    members["checksums.json"] = json.dumps({k: hashlib.sha256(v).hexdigest() for k, v in members.items()}).encode()
    path = tmp_path / "test.blabsp"
    with zipfile.ZipFile(path, "w") as archive:
        for key, payload in members.items():
            archive.writestr(key, payload)
    before = path.read_bytes()
    data = _load_deploy_package_data(path)
    expected = value if convention == PLUS else value.conj()
    np.testing.assert_array_equal(data.pressure, expected)
    np.testing.assert_array_equal(data.normal, 2 * expected)
    for name in names:
        np.testing.assert_array_equal(data.coupled_model["arrays"][name], expected)
    np.testing.assert_array_equal(data.coupled_model["arrays"]["frequencies_hz"], [100.0])
    np.testing.assert_array_equal(convert_phasor(data.pressure, data.manifest["phasor_convention"]), expected)
    assert path.read_bytes() == before
