"""An AMD-ready source environment must not hide missing bundled compiler assets."""
import runpy
from pathlib import Path

import pytest


@pytest.fixture
def builder():
    return runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/build_runtime.py"))


def test_rocm_is_explicit_and_requires_engine_environment(builder, tmp_path):
    for name in ("julia_local", "julia_cuda"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "Project.toml").write_text("[deps]\n")
    select = builder["runtime_projects"]
    assert [p.name for p in select(tmp_path)] == ["julia_local", "julia_cuda"]
    with pytest.raises(RuntimeError, match="julia_rocm"):
        select(tmp_path, True)
    (tmp_path / "julia_rocm").mkdir()
    (tmp_path / "julia_rocm/Project.toml").write_text("[deps]\n")
    with pytest.raises(RuntimeError, match="Manifest.toml"):
        select(tmp_path, True)
    (tmp_path / "julia_rocm/Manifest.toml").write_text('manifest_format = "2.0"\n')
    assert [p.name for p in select(tmp_path, True)] == ["julia_local", "julia_cuda", "julia_rocm"]


@pytest.fixture
def rocm_inventory():
    names = ("AMDGPU", "AMDGPU_LLVM_Backend_jll", "ROCmDeviceLibs_jll")
    inventory = {"packages": {str(i): {"name": name} for i, name in enumerate(names)},
                 "artifacts": {"a" * 40: "AMDGPU_LLVM_Backend", "b" * 40: "ROCmDeviceLibs"}}
    files = [f"runtime/julia-depot/packages/{name}/abc12/Project.toml" for name in names]
    files += ["runtime/python/Lib/site-packages/beat_engine/julia_rocm/Project.toml",
              "runtime/python/Lib/site-packages/beat_engine/julia_rocm/Manifest.toml",
              "runtime/julia-depot/artifacts/" + "a" * 40 + "/bin/lld.exe",
              "runtime/julia-depot/artifacts/" + "b" * 40 + "/amdgcn/bitcode/ocml.bc"]
    return files, inventory


def test_inventory_requires_actual_artifact_and_package_files(builder, rocm_inventory):
    files, inventory = rocm_inventory
    check = builder["validate_rocm_inventory"]
    check(files, inventory)
    for missing in files:
        with pytest.raises(RuntimeError, match="Incomplete ROCm"):
            check([path for path in files if path != missing], inventory)


def test_unrecorded_artifacts_do_not_satisfy_inventory(builder, rocm_inventory):
    files, inventory = rocm_inventory
    inventory["artifacts"] = {}
    with pytest.raises(RuntimeError, match="artifact files"):
        builder["validate_rocm_inventory"](files, inventory)


def test_inventory_normalizes_windows_separators(builder, rocm_inventory):
    files, inventory = rocm_inventory
    builder["validate_rocm_inventory"]([name.replace("/", "\\") for name in files], inventory)


def test_rocm_staging_excludes_developer_depot_and_library_overrides(builder, monkeypatch, tmp_path):
    for name in ("JULIA_DEPOT_PATH", "ROCM_PATH", "HIP_DEVICE_LIB_PATH", "HSA_OVERRIDE_GFX_VERSION",
                 "ROCR_VISIBLE_DEVICES", "DEVICE_LIB_PATH", "GPU_DEVICE_ORDINAL"):
        monkeypatch.setenv(name, "developer-override")
    monkeypatch.setenv("USER_BUILD_SENTINEL", "preserved")
    depot = tmp_path / "isolated-depot"
    environment = builder["staging_environment"](depot)
    assert environment["JULIA_DEPOT_PATH"] == str(depot)
    assert environment["JULIA_LOAD_PATH"] == "@;@stdlib"
    assert environment["JULIA_PKG_PRECOMPILE_AUTO"] == "0"
    assert environment["USER_BUILD_SENTINEL"] == "preserved"
    assert "developer-override" not in environment.values()
