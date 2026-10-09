"""Research replay must preserve saved placement and electrical drive settings."""
import copy
import hashlib
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/research_deploy_compression.py"
spec = importlib.util.spec_from_file_location("research_compression", SCRIPT)
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)


def test_drive_overlay_updates_each_instance_and_boundary_trace():
    model = {"node_orbits": [[0]], "face_orbits": [[0]], "instances": [
        {"node_offset": 0, "face_offset": 0, "input_real": [1.0], "input_imag": [2.0]},
        {"node_offset": 1, "face_offset": 1, "input_real": [1.0], "input_imag": [2.0]}]}
    request = {"rom": model, "reference_boundary_pressure": {"real": [1.0, 1.0], "imag": [2.0, 2.0]},
               "boundary_neumann": {"real": [1.0, 1.0], "imag": [2.0, 2.0]}}
    research.apply_drive_update(request)
    values = [complex(i["input_real"][0], i["input_imag"][0]) for i in model["instances"]]
    assert values[0] != values[1] != complex(1, 2)
    for key in ("reference_boundary_pressure", "boundary_neumann"):
        assert [complex(a, b) for a, b in zip(request[key]["real"], request[key]["imag"], strict=True)] == values


def test_saved_scene_drive_and_package_identity(tmp_path):
    package = tmp_path / "speaker.blabsp"
    package.write_bytes(b"fixture")
    source = {"id": "speaker", "packageId": "p", "channelId": "c", "levelDb": -2,
              "delayMs": 3, "polarity": -1, "positionX": 4, "equalizer": {"filters": []}}
    scene = {"schema": "boundary-lab-deploy-project", "schema_version": 12,
             "sources": [source], "system_gain_db": 32,
             "channels": [{"id": "c", "levelDb": -24, "delayMs": 2, "polarity": -1,
                           "muted": True, "equalizer": {"filters": []}}],
             "packages": [{"id": "p", "source_file": package.name,
                           "fingerprint": hashlib.sha256(b"fixture").hexdigest()}],
             "microphones": [{"positionX": 1, "positionHeightM": 2, "positionZ": 3}]}
    payload = research.scene_payload(scene, tmp_path / "scene.json", 1, 32.0)
    drive = payload["sources"][0]
    assert (drive["levelDb"], drive["delayMs"], drive["polarity"], drive["muted"]) == (6, 5, 1, True)
    assert source["levelDb"] == -2
    assert drive["positionX"] == 4
    assert payload["observationPointsM"] == [[1, 2, 3]]
    package.write_bytes(b"changed")
    with pytest.raises(ValueError, match="fingerprint"):
        research.scene_payload(scene, tmp_path / "scene.json", 1, 32)


def test_comparison_rejects_error_and_unconverged_reference():
    spec = importlib.util.spec_from_file_location("compare_compression", SCRIPT.with_name("compare_deploy_compression.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    z = {"real": [1., 2.], "imag": [2., -1.]}
    reference = {"frequency_hz": 32., "sample_indices": [0, 1], "rows": 1, "columns": 2,
                 "field_pressure": z, "diagnostics": {"transducer_velocity": [z], "transducer_current": [z],
                 "schur_gmres_relative_residual": 1e-5,
                 "rhs_compression": {"exact_preconditioned_relative_residual": 1e-5}}}
    candidate = copy.deepcopy(reference)
    assert module.compare(reference, candidate)["passed"]
    assert module.pressure_error(reference, candidate)["passed"]
    candidate["field_pressure"]["real"][0] *= 1.2
    assert not module.compare(reference, candidate)["passed"]
    assert not module.pressure_error(reference, candidate)["passed"]
    candidate = copy.deepcopy(reference)
    reference["diagnostics"]["schur_gmres_relative_residual"] = 0.1
    assert not module.compare(reference, candidate)["passed"]
