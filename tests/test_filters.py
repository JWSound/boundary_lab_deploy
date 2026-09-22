import json
from pathlib import Path

import numpy as np
import pytest

from boundary_deploy.filters import equalizer_response, parse_equalizer, source_drive
from boundary_deploy.solve import DeploySourcePlacement
from boundary_deploy.worker import _solution_identity

VECTORS = json.loads(Path(__file__).with_name("filter_response_vectors.json").read_text())


@pytest.mark.parametrize("case", VECTORS)
def test_shared_reference_vectors(case):
    actual = equalizer_response(parse_equalizer(case["bank"]), case["frequencyHz"])
    assert actual == pytest.approx(complex(case["real"], case["imag"]), abs=1e-12)


def test_peq_reciprocity_shelves_allpass_and_bypass():
    f = dict(id="f", type="peq", enabled=True, frequencyHz=100, gainDb=12, q=0.7)
    for frequency in np.geomspace(0.001, 1e8, 60):
        boost = equalizer_response({"filters": [f]}, frequency)
        cut = equalizer_response({"filters": [{**f, "gainDb": -12}]}, frequency)
        assert boost * cut == pytest.approx(1)
        assert abs(equalizer_response({"filters": [{**f, "type": "allpass"}]}, frequency)) == pytest.approx(1)
    for kind, dc, high in [("low-shelf", 10**0.6, 1), ("high-shelf", 1, 10**0.6)]:
        bank = {"filters": [{**f, "type": kind}]}
        assert equalizer_response(bank, 0) == pytest.approx(dc)
        assert abs(equalizer_response(bank, 1e9)) == pytest.approx(high)
    assert equalizer_response({"filters": [f], "bypassed": True}, 100) == 1
    assert equalizer_response({"filters": [{**f, "enabled": False}]}, 100) == 1
    source = DeploySourcePlacement.from_payload({"id": "s", "levelDb": 3, "polarity": -1, "delayMs": 2,
        "equalizer": {"filters": [f]}, "channelEqualizer": {"filters": [f]}})
    expected = -10**(27/20) * np.exp(-2j*np.pi*100*0.002)
    assert source_drive(source, 100) == pytest.approx(expected)
    from dataclasses import replace
    assert source_drive(replace(source, muted=True), 100) == 0


@pytest.mark.parametrize("patch", [{"q": 0}, {"frequencyHz": float("nan")}, {"gainDb": True},
    {"enabled": 1}, {"type": "unknown"}, {"family": "bad"}, {"order": 2}])
def test_reject_invalid_filters_even_when_bypassed(patch):
    f = dict(id="f", type="peq", enabled=True, frequencyHz=100, gainDb=0, q=1)
    with pytest.raises(ValueError):
        parse_equalizer({"bypassed": True, "filters": [{**f, **patch}]})


def test_bank_validation_and_cache_identity(tmp_path):
    for bank in [None, {}, {"filters": [], "bypassed": 1}, {"filters": [None]}]:
        with pytest.raises(ValueError):
            parse_equalizer(bank)
    f = dict(id="f", type="lowpass", enabled=True, frequencyHz=100, gainDb=0, q=1)
    for filters in [[f, f], [{**f, "family": "linkwitz-riley", "order": 3}], [{**f, "order": True}]]:
        with pytest.raises(ValueError):
            parse_equalizer({"filters": filters})
    package = tmp_path / "package.blabsp"
    package.touch()
    payload = {"packagePath": str(package), "sources": [{"id": "s", "equalizer": {"filters": [f]}}]}
    key = _solution_identity(payload)
    assert _solution_identity({**payload, "observationPointsM": [[1, 2, 3]]}) == key
    payload["sources"][0]["equalizer"]["bypassed"] = True
    assert _solution_identity(payload) != key
