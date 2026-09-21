"""Consume actual Boundary Lab exporter outputs without its Python application."""

import json
import zipfile
from pathlib import Path

import pytest

from boundary_deploy.assets import DeploySolveCache
from boundary_deploy.solve import stage_exact_coupled_system

FIXTURES = Path(__file__).parent / "fixtures/speaker-packages"


@pytest.mark.parametrize(
    "name,symmetry,sectors",
    [
        ("rom-xy", "xy", 4),
        ("rom-x", "x", 2),
        ("rom-legacy-extra", "xy", 4),
    ],
)
def test_exported_rom_arrays_and_legacy_extra(name, symmetry, sectors):
    cache = DeploySolveCache()
    try:
        package = cache.load_package(FIXTURES / (name + ".blabsp"))
        assert package.coupled_model["symmetry_mode"] == symmetry
        for array in ("k", "d", "velocity"):
            assert package.coupled_model["arrays"][array].shape == (2, sectors, 2, 2)
        assert not hasattr(package, "isolated_acoustic_impedance")
    finally:
        cache.close()


def test_exported_exact_meshes_stage_portably(tmp_path):
    path = FIXTURES / "exact.blabsp"
    cache = DeploySolveCache()
    try:
        package = cache.load_package(path)
        staged = stage_exact_coupled_system(package, tmp_path)
        assert staged["mesh_path_kind"] == "local_file"
        with zipfile.ZipFile(path) as archive:
            descriptor = json.loads(archive.read(package.manifest["files"]["coupled_model"]["path"]))
            for mesh in staged["compiled_system"]["meshes"]:
                actual = Path(mesh["file"])
                assert actual.is_relative_to(tmp_path)
                assert actual.read_bytes() == archive.read(descriptor["mesh_members"][mesh["id"]])
    finally:
        cache.close()
