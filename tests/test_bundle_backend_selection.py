"""Bundle verification must exercise and report the requested accelerator."""

import hashlib
import json
import runpy
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    main = runpy.run_path(str(scripts / "verify_bundle.py"))["main"]
    resources = tmp_path / "resources"
    resources.mkdir()
    files = {}
    for name in ("cublas64_13.dll", "cublasLt64_13.dll", "cudart64_13.dll",
                 "cusolver64_12.dll", "cusparse64_12.dll", "cudss64_0.dll",
                 "nvJitLink_130_0.dll", "ptxas.exe"):
        (resources / name).write_bytes(b"fixture")
        files[name] = hashlib.sha256(b"fixture").hexdigest()
    (resources / "runtime-manifest.json").write_text(json.dumps({
        "platform": "win32", "runtime_id": "test-runtime", "files": files,
    }))
    user = tmp_path / "user"
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("SystemRoot", str(tmp_path / "Windows"))
    monkeypatch.setattr(sys, "argv", ["verify_bundle.py", "--resources", str(resources),
                                    "--in-place", "--data-directory", str(user),
                                    "--solve", "--qualify-backends"])
    return main, resources, user


@pytest.mark.parametrize("backend,solve,qualification", [
    (None, "cuda", "both"), ("cuda", "cuda", "both"),
    ("cpu", "cpu", "both"), ("rocm", "rocm", "cpu-rocm"),
])
def test_requested_backend_reaches_bundled_commands_and_report(bundle, monkeypatch, backend, solve, qualification):
    main, resources, user = bundle
    if backend:
        sys.argv.extend(["--backend", backend])
    calls = []

    def run(command, **kwargs):
        calls.append(([str(item) for item in command], kwargs))
        return SimpleNamespace(stdout='{"type":"ready"}\n')

    monkeypatch.setattr(subprocess, "run", run)
    main()
    assert len(calls) == 3
    for command, kwargs in calls:
        assert Path(command[0]).is_relative_to(resources)
        assert kwargs["env"]["JULIA_PKG_OFFLINE"] == "true"
        assert kwargs["check"] is True
    smoke, check = calls[1][0], calls[2][0]
    assert smoke[smoke.index("--backend") + 1] == solve
    assert check[check.index("--backend") + 1] == qualification
    report = json.loads((user / "verification.json").read_text())
    assert report["solve_backend"] == solve
    assert report["qualification_backends"] == ["cpu", "rocm" if backend == "rocm" else "cuda"]
    assert report["resources_unchanged"] is True


def test_developer_rocm_overrides_do_not_reach_bundle_verification(bundle, monkeypatch):
    main, resources, user = bundle
    sys.argv.extend(["--backend", "rocm"])
    overrides = {
        "ROCM_PATH": "developer-sdk", "HIP_PATH": "developer-hip",
        "HIP_DEVICE_LIB_PATH": "developer-bitcode", "DEVICE_LIB_PATH": "other-bitcode",
        "HSA_OVERRIDE_GFX_VERSION": "10.3.0", "HIP_VISIBLE_DEVICES": "9",
        "ROCR_VISIBLE_DEVICES": "9", "GPU_DEVICE_ORDINAL": "9",
        "HIP_LAUNCH_BLOCKING": "1", "rocm_custom_override": "mixed-case",
    }
    for key, value in overrides.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("DEPLOY_VERIFICATION_TEST_SENTINEL", "must-be-cleared")
    monkeypatch.setenv("USER_TEST_SENTINEL", "keep")
    environments = []

    def run(command, **kwargs):
        environments.append(kwargs["env"])
        return SimpleNamespace(stdout='{"type":"ready"}\n')

    monkeypatch.setattr(subprocess, "run", run)
    main()
    assert len(environments) == 3
    for environment in environments:
        normalized = {key.upper(): value for key, value in environment.items()}
        assert not {key.upper() for key in overrides}.intersection(normalized)
        assert "DEPLOY_VERIFICATION_TEST_SENTINEL" not in environment
        assert environment["USER_TEST_SENTINEL"] == "keep"
        assert environment["PATH"] == str(Path(normalized["SYSTEMROOT"]) / "System32")
        assert environment["JULIA_PKG_OFFLINE"] == "true"


def test_declared_rocm_bundle_rejects_missing_compiler_before_worker_start(bundle, monkeypatch):
    main, resources, user = bundle
    manifest_path = resources / "runtime-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["staged_backends"] = ["cpu", "cuda", "rocm"]
    manifest_path.write_text(json.dumps(manifest))
    depot = resources / "runtime/julia-depot"
    depot.mkdir(parents=True)
    (depot / "inventory.toml").write_text("[packages]\n[artifacts]\n")

    def unexpected_run(*args, **kwargs):
        pytest.fail("An incomplete declared ROCm bundle must fail before launching the worker")

    monkeypatch.setattr(subprocess, "run", unexpected_run)
    with pytest.raises(RuntimeError, match="Incomplete ROCm"):
        main()
    assert not (user / "verification.json").exists()


@pytest.mark.parametrize("failure", ["solver", "resource-mutation"])
def test_failed_rocm_qualification_never_writes_success_report(bundle, monkeypatch, failure):
    main, resources, user = bundle
    sys.argv.extend(["--backend", "rocm"])

    def run(command, **kwargs):
        if any(str(item).endswith("check_solver_backends.py") for item in command):
            if failure == "solver":
                raise subprocess.CalledProcessError(1, command)
            (resources / "ptxas.exe").write_bytes(b"changed")
        return SimpleNamespace(stdout='{"type":"ready"}\n')

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises((subprocess.CalledProcessError, RuntimeError)):
        main()
    assert not (user / "verification.json").exists()
