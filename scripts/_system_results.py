"""Decode BEAT system-result quantities for the offline developer tools."""

from __future__ import annotations

import base64
import binascii
from types import SimpleNamespace
from typing import Any

import numpy as np

from boundary_deploy.phasor import LEGACY_PHASOR_CONVENTION, SOLVER_PHASOR_CONVENTION, convert_phasor


def system_frequency_result_from_dict(raw):
    if raw.get("schema_version") not in (1, 2):
        raise ValueError("Unsupported system result schema_version")
    frequency = float(raw["freq_hz"])
    if not np.isfinite(frequency) or frequency <= 0:
        raise ValueError("System result frequency must be finite and positive")
    diagnostics = dict(raw.get("diagnostics", {}))
    source = diagnostics.get("phasor_convention", LEGACY_PHASOR_CONVENTION)
    convert_phasor(0j, source)
    quantities = []
    for item in raw.get("quantities", ()):
        values = convert_phasor(_array_from_wire(item["values"]), source)
        if not np.isfinite(values).all():
            raise ValueError("Result quantities must be finite")
        quantities.append(
            SimpleNamespace(
                id=item["id"], quantity=item["quantity"], values=values, metadata=dict(item.get("metadata", {}))
            )
        )
    if source != SOLVER_PHASOR_CONVENTION:
        diagnostics["source_phasor_convention"] = source
    diagnostics["phasor_convention"] = SOLVER_PHASOR_CONVENTION
    return SimpleNamespace(freq_hz=frequency, quantities=tuple(quantities), diagnostics=diagnostics)


def _array_from_wire(raw: dict[str, Any]) -> np.ndarray:
    dtype = np.dtype(str(raw["dtype"]))
    if dtype.kind not in {"f", "i", "u", "c", "b"}:
        raise ValueError(f"Unsupported result array dtype: {dtype}")
    shape = tuple(int(value) for value in raw.get("shape", ()))
    if any(value < 0 for value in shape):
        raise ValueError(f"Result array shape must be nonnegative: {shape}.")
    expected_size = int(np.prod(shape, dtype=np.int64)) if shape else 1
    if "content_base64" in raw:
        if str(raw.get("encoding", "")) != "base64":
            raise ValueError("Result array binary payload must use base64 encoding.")
        if str(raw.get("order", "")) != "C":
            raise ValueError("Result array binary payload must use row-major order.")
        if str(raw.get("byte_order", "")) != "little":
            raise ValueError("Result array binary payload must use little-endian byte order.")
        try:
            payload = base64.b64decode(str(raw["content_base64"]), validate=True)
        except (binascii.Error, ValueError, TypeError) as exc:
            raise ValueError("Result array contains invalid base64 data.") from exc
        expected_nbytes = expected_size * dtype.itemsize
        if len(payload) != expected_nbytes:
            raise ValueError(
                f"Result array payload contains {len(payload)} bytes, expected {expected_nbytes} "
                f"for dtype {dtype} and shape {shape}."
            )
        wire_dtype = dtype.newbyteorder("<")
        values = np.frombuffer(payload, dtype=wire_dtype, count=expected_size)
        native_dtype = dtype.newbyteorder("=")
        return np.array(values, dtype=native_dtype, copy=True).reshape(shape)

    # Schema-v1 compatibility for decimal real/imag list payloads.
    if dtype.kind == "c":
        real_dtype = np.empty((), dtype=dtype).real.dtype
        real = np.asarray(raw.get("real", ()), dtype=real_dtype)
        imag = np.asarray(raw.get("imag", ()), dtype=real_dtype)
        values = (real + 1j * imag).astype(dtype, copy=False)
    else:
        values = np.asarray(raw.get("real", ()), dtype=dtype)
    if values.size != expected_size:
        raise ValueError(
            f"Result array payload contains {values.size} values, expected {expected_size} for shape {shape}."
        )
    return values.reshape(shape)
