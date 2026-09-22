"""Ideal analog processing at exp(+i omega t); no audio device or sample rate."""
from __future__ import annotations

import cmath
import math


def parse_equalizer(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("filters"), list):
        raise ValueError("equalizer.filters must be an array")
    bypassed = value.get("bypassed", False)
    if not isinstance(bypassed, bool) or len(value["filters"]) > 64:
        raise ValueError("Invalid equalizer bypass or filter count (maximum 64)")
    filters, ids = [], set()
    for raw in value["filters"]:
        if not isinstance(raw, dict):
            raise ValueError("Filter must be an object")
        f = dict(raw)
        if not isinstance(f.get("id"), str) or not f["id"].strip() or f["id"] in ids:
            raise ValueError("Filter ids must be nonempty and unique within a bank")
        ids.add(f["id"])
        if f.get("type") not in ("peq", "lowpass", "highpass", "low-shelf", "high-shelf", "allpass"):
            raise ValueError("Unsupported filter type")
        if not isinstance(f.get("enabled"), bool):
            raise ValueError("Filter enabled must be boolean")
        for key, low, high in (("frequencyHz", 1, 100000), ("gainDb", -60, 60), ("q", 0.05, 100)):
            v = f.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high:
                raise ValueError(f"Invalid filter {key}")
        if f["type"] in ("lowpass", "highpass"):
            family, order = f.get("family", "butterworth"), f.get("order", 2)
            if family not in ("butterworth", "linkwitz-riley") or isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order) or order != int(order):
                raise ValueError("Invalid crossover family/order")
            if order not in (range(1, 9) if family == "butterworth" else (2, 4, 6, 8)):
                raise ValueError("Invalid crossover order")
            f.update(family=family, order=int(order))
        elif "family" in f or "order" in f:
            raise ValueError("family/order only apply to crossovers")
        filters.append(f)
    return {"filters": filters, "bypassed": bypassed}


def equalizer_response(bank: dict, frequency_hz: float) -> complex:
    if not math.isfinite(frequency_hz) or frequency_hz < 0:
        raise ValueError("Evaluation frequency must be finite and nonnegative")
    result = 1 + 0j
    if bank.get("bypassed", False):
        return result
    for f in bank["filters"]:
        if not f["enabled"]:
            continue
        s = 1j * frequency_hz / f["frequencyHz"]
        kind, q = f["type"], f["q"]
        a = 10 ** (f["gainDb"] / 40)
        if kind in ("lowpass", "highpass"):
            order = f.get("order", 2)
            lr = f.get("family", "butterworth") == "linkwitz-riley"
            n = order // 2 if lr else order
            h = (1 / (s + 1) if kind == "lowpass" else s / (s + 1)) if n % 2 else 1 + 0j
            for k in range(n // 2):
                damping = 2 * math.sin((2 * k + 1) * math.pi / (2 * n))
                h *= (1 if kind == "lowpass" else s * s) / (s * s + damping * s + 1)
            result *= h * h if lr else h
        elif kind == "peq":
            result *= (s*s + a/q*s + 1) / (s*s + s/(a*q) + 1)
        elif kind == "allpass":
            result *= (s*s - s/q + 1) / (s*s + s/q + 1)
        elif kind == "low-shelf":
            result *= a * (s*s + math.sqrt(a)/q*s + a) / (a*s*s + math.sqrt(a)/q*s + 1)
        else:
            result *= a * (a*s*s + math.sqrt(a)/q*s + 1) / (s*s + math.sqrt(a)/q*s + a)
    return result


def source_drive(source, frequency_hz: float) -> complex:
    response = equalizer_response(source.equalizer, frequency_hz) * equalizer_response(source.channel_equalizer, frequency_hz)
    if source.muted:
        return 0j
    return source.polarity * 10 ** (source.level_db / 20) * cmath.exp(
        -2j * math.pi * frequency_hz * source.delay_ms / 1000
    ) * response
