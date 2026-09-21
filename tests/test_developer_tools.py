"""The migrated tools use only Deploy and the public BEAT API."""

import base64
import runpy
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
TOOLS = (
    "benchmark_deploy_level3",
    "build_speaker_rom_package",
    "experiment_speaker_rom_rank",
    "validate_deploy_speaker_rom",
    "validate_deploy_speaker_rom_band",
)


@pytest.mark.parametrize("name", TOOLS)
def test_help_without_boundary_lab(name, tmp_path):
    code = """
import importlib.abc, runpy, sys
class NoBoundaryLab(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'blab' or fullname.startswith('blab.'):
            raise AssertionError('Boundary Lab import: ' + fullname)
sys.meta_path.insert(0, NoBoundaryLab())
sys.path.insert(0, sys.argv[1])
script = sys.argv[2]
sys.argv = [script, '--help']
runpy.run_path(script, run_name='__main__')
"""
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(SCRIPTS), str(SCRIPTS / (name + ".py"))],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "usage:" in result.stdout


@pytest.mark.parametrize("binary", [False, True])
@pytest.mark.parametrize("convention", [None, "exp(-i omega t)", "exp(+i omega t)"])
def test_system_result_decodes_wire_values_and_phasor(binary, convention):
    decode = runpy.run_path(str(SCRIPTS / "_system_results.py"))["system_frequency_result_from_dict"]
    values = np.array([[1 + 2j, 3 - 4j]], dtype=np.complex64)
    wire = {"dtype": "complex64", "shape": [1, 2]}
    if binary:
        wire.update(
            encoding="base64",
            order="C",
            byte_order="little",
            content_base64=base64.b64encode(values.astype("<c8").tobytes()).decode(),
        )
    else:
        wire.update(real=[1, 3], imag=[2, -4])
    raw = {
        "schema_version": 2 if binary else 1,
        "freq_hz": 100.0,
        "quantities": [{"id": "q", "quantity": "pressure", "values": wire, "metadata": {"validation": []}}],
        "diagnostics": {} if convention is None else {"phasor_convention": convention},
    }
    result = decode(raw)
    assert result.freq_hz == 100.0
    np.testing.assert_array_equal(
        result.quantities[0].values, values if convention == "exp(+i omega t)" else values.conj()
    )
    assert result.quantities[0].values.dtype == values.dtype
    assert result.quantities[0].metadata == {"validation": []}
    assert result.diagnostics["phasor_convention"] == "exp(+i omega t)"
    wire["shape"] = [3]
    with pytest.raises(ValueError):
        decode(raw)
