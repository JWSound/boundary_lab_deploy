"""Notarization must fail closed and retain evidence for rejected submissions."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def release():
    script = Path(__file__).resolve().parents[1] / "scripts/release_macos.py"
    spec = importlib.util.spec_from_file_location("release_macos", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_rejected_submission_saves_log_without_stapling(tmp_path, monkeypatch, release):
    dmg = tmp_path / "candidate.dmg"
    dmg.write_bytes(b"signed candidate")
    calls = []

    def run(*args, **kwargs):
        calls.append(args)
        operation = args[2]
        if operation == "submit":
            return SimpleNamespace(stdout=json.dumps({"id": "submission-1"}))
        if operation == "wait":
            assert kwargs["check"] is False
            return SimpleNamespace(returncode=1)
        if operation == "info":
            return SimpleNamespace(stdout=json.dumps({"status": "Invalid"}))
        if operation == "log":
            Path(args[-1]).write_text('{"issues": ["bad signature"]}')
            return SimpleNamespace(returncode=0)
        pytest.fail(f"Unexpected operation: {args}")

    monkeypatch.setattr(release, "run", run)
    with pytest.raises(RuntimeError, match="Apple rejected"):
        release.notarize(dmg, "test-profile")
    assert (tmp_path / "notarization-log.json").exists()
    assert json.loads((tmp_path / "notarization-submission.json").read_text())["submitted_sha256"] == release.digest(dmg)
    assert not any("stapler" in call for call in calls)


def test_resume_rejects_changed_dmg_without_contacting_apple(tmp_path, monkeypatch, release):
    dmg = tmp_path / "candidate.dmg"
    dmg.write_bytes(b"original")
    (tmp_path / "notarization-submission.json").write_text(json.dumps({
        "id": "submission-1", "submitted_sha256": release.digest(dmg),
    }))
    dmg.write_bytes(b"changed")
    monkeypatch.setattr(release, "run", lambda *args, **kwargs: pytest.fail("Should fail locally"))
    with pytest.raises(RuntimeError, match="DMG changed"):
        release.notarize(dmg, "test-profile")
