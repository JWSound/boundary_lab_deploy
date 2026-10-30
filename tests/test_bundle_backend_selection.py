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
