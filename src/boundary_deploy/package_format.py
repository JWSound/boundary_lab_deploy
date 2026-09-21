"""Reader-side speaker archive contract; independent of the authoring application."""
import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

from boundary_deploy.phasor import LEGACY_PHASOR_CONVENTION, convert_phasor

SPEAKER_PACKAGE_SCHEMA = "boundary-lab-speaker-package"
SPEAKER_PACKAGE_SCHEMA_VERSION = 1

def validate_speaker_package(path: str | Path) -> dict[str, Any]:
    """Validate archive structure and checksums and return its manifest."""

    try:
        with zipfile.ZipFile(path, "r") as archive:
            members = set(archive.namelist())
            if "manifest.json" not in members or "checksums.json" not in members:
                raise ValueError("Speaker package is missing manifest.json or checksums.json.")
            manifest = json.loads(archive.read("manifest.json"))
            checksums = json.loads(archive.read("checksums.json"))
            if manifest.get("schema") != SPEAKER_PACKAGE_SCHEMA:
                raise ValueError("Unsupported speaker package schema.")
            if int(manifest.get("schema_version", 0)) != SPEAKER_PACKAGE_SCHEMA_VERSION:
                raise ValueError("Unsupported speaker package schema version.")
            for member, expected in checksums.items():
                if member not in members:
                    raise ValueError(f"Speaker package is missing referenced member {member!r}.")
                actual = hashlib.sha256(archive.read(member)).hexdigest()
                if actual != expected:
                    raise ValueError(f"Speaker package member {member!r} failed its checksum.")
            convert_phasor(0j, manifest.get("phasor_convention", LEGACY_PHASOR_CONVENTION))
            return manifest
    except zipfile.BadZipFile as exc:
        raise ValueError("File is not a valid .blabsp archive.") from exc
