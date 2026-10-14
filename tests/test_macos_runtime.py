"""Pinned runtime extraction must retain executables without allowing escaping links."""

import hashlib
import io
import runpy
import sys
import tarfile
from pathlib import Path

import pytest


def test_local_engine_wheel_must_match_release_pin(tmp_path, monkeypatch):
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    resolve = runpy.run_path(str(scripts / "build_runtime_macos.py"))["engine_requirement"]
    wheel = tmp_path / "beat_engine-0.5.1-py3-none-any.whl"
    wheel.write_bytes(b"candidate wheel")
    checksum = hashlib.sha256(wheel.read_bytes()).hexdigest()
    lock = {"beat_requirement": f"beat-engine @ https://example.com/{wheel.name}#sha256={checksum}"}
    assert resolve(lock) == lock["beat_requirement"]
    assert resolve(lock, wheel) == wheel.resolve()
    wheel.write_bytes(b"different candidate")
    with pytest.raises(ValueError, match="SHA-256"):
        resolve(lock, wheel)


def test_runtime_archive_preserves_modes_and_rejects_escaping_symlinks(tmp_path, monkeypatch):
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    extract = runpy.run_path(str(scripts / "build_runtime_macos.py"))["extract"]
    archive = tmp_path / "runtime.tar.gz"
    with tarfile.open(archive, "w:gz") as stream:
        executable = tarfile.TarInfo("python/bin/python3.13")
        executable.mode = 0o755
        executable.size = 4
        stream.addfile(executable, io.BytesIO(b"test"))
        link = tarfile.TarInfo("python/bin/python3")
        link.type = tarfile.SYMTYPE
        link.linkname = "python3.13"
        stream.addfile(link)
        sidecar = tarfile.TarInfo("python/bin/._python3.13")
        sidecar.size = 4
        stream.addfile(sidecar, io.BytesIO(b"meta"))
    if not hasattr(tarfile, "data_filter"):
        pytest.skip("macOS runtime builder requires Python 3.12+")
    if sys.platform == "win32":
        pytest.skip("macOS executable modes and symlinks require a Unix host")
    destination = tmp_path / "safe"
    extract(archive, destination)
    assert (destination / "python/bin/python3").read_bytes() == b"test"
    assert (destination / "python/bin/python3.13").stat().st_mode & 0o111
    assert not (destination / "python/bin/._python3.13").exists()
    with tarfile.open(archive, "w:gz") as stream:
        link = tarfile.TarInfo("escape")
        link.type = tarfile.SYMTYPE
        link.linkname = "../../outside"
        stream.addfile(link)
    with pytest.raises(tarfile.FilterError):
        extract(archive, tmp_path / "unsafe")
