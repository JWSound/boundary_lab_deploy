"""Adapt a continuous-speaker-v1 interior to BEAT's single-sector boundary operator."""

import base64

import numpy as np


def _matrix(entry, expected_shape):
    shape = tuple(entry["shape"])
    if shape != expected_shape:
        raise ValueError(f"Continuous ROM matrix has shape {shape}, expected {expected_shape}.")
    if entry["storage"] == "f64le-column-major":
        raw = base64.b64decode(entry["base64"], validate=True)
        values = np.frombuffer(raw, dtype="<f8").reshape(shape, order="F")
    elif entry["storage"] == "coo":
        values = np.zeros(shape)
        rows, cols = (np.asarray(entry[key], dtype=int) for key in ("rows", "columns"))
        if np.any(rows < 0) or np.any(cols < 0):
            raise ValueError("Invalid continuous ROM matrix indices.")
        np.add.at(values, (rows, cols), entry["values"])
    else:
        raise ValueError("Unsupported continuous ROM matrix storage.")
    if not np.isfinite(values).all():
        raise ValueError("Continuous ROM contains nonfinite coefficients.")
    return values


class ContinuousInterior:
    def __init__(self, data, declaration, manifest):
        metadata = data["metadata"]
        if (
            metadata["format"] != "continuous-speaker-v1"
            or metadata["phasor"] != "exp(+i omega t)"
            or metadata["phasor"] != manifest.get("phasor_convention")
            or declaration.get("format_version") != 1
        ):
            raise ValueError("Unsupported continuous ROM format or phasor convention.")
        self.band = tuple(data["band"])
        if (
            list(self.band) != declaration["frequency_band_hz"]
            or len(self.band) != 2
            or not np.isfinite(self.band).all()
            or not 0 < self.band[0] <= self.band[1]
        ):
            raise ValueError("Invalid continuous ROM frequency band.")
        if data["ports"] != manifest["excitation_port_ids"]:
            raise ValueError("Continuous ROM port order differs from its package.")
        self.points = np.asarray(data["geometry"]["points"])
        self.triangles = np.asarray(data["geometry"]["triangles"])
        self.c, self.rho = data["c"], data["rho"]
        medium = manifest["medium"]
        if (
            not np.allclose(
                [self.c, self.rho], [medium["sound_speed_m_per_s"], medium["density_kg_per_m3"]], rtol=1e-6, atol=0
            )
            or min(self.c, self.rho) <= 0
        ):
            raise ValueError("Continuous ROM exterior medium differs from its package.")
        self.drivers = data["drivers"]
        matrices = data["matrices"]
        n = matrices["K"]["shape"][0]
        ng = matrices["gram"]["shape"][0]
        drivers, ports = len(self.drivers), len(data["ports"])
        if not 0 <= ng <= n or min(n, drivers, ports) <= 0:
            raise ValueError("Invalid continuous ROM dimensions.")
        nodes, faces = len(self.points), len(self.triangles)
        shapes = {
            "K": (n, n),
            "M": (n, n),
            "loss": (n, n),
            "gram": (ng, ng),
            "trace": (ng, nodes),
            "flux": (faces, ng),
            "bem_velocity": (faces, drivers),
            "bem_force": (nodes, drivers),
            "surface": (n, drivers),
            "force": (n, drivers),
            "drive": (drivers, ports),
        }
        m = self.matrices = {key: _matrix(matrices[key], shape) for key, shape in shapes.items()}
        self.walls = [
            (w["thickness_m"], w["flow_resistivity_pa_s_per_m2"], _matrix(w["matrix"], (n, n))) for w in data["walls"]
        ]
        # Only the exterior nodes and faces with nonzero coupling need worker orbit entries.
        self.nodes = np.flatnonzero(m["trace"].any(axis=0) | m["bem_force"].any(axis=1))
        self.faces = np.flatnonzero(m["flux"].any(axis=1) | m["bem_velocity"].any(axis=1))
        if not len(self.nodes) or not len(self.faces):
            raise ValueError("Continuous ROM has no active boundary.")
        self.rank = m["K"].shape[0] + 2 * len(self.drivers)
        self.trace = m["trace"][:, self.nodes]

    def operators(self, hz):
        """Map the exported equations onto the worker contract K x = B u - C p."""
        if not self.band[0] <= hz <= self.band[1]:
            raise ValueError(f"Frequency {hz:g} Hz outside continuous ROM band {self.band}.")
        m = self.matrices
        s = 2j * np.pi * hz
        k = 2 * np.pi * hz / self.c
        scale = -self.rho * s
        a = m["K"] - k**2 * (m["M"] - 1j * m["loss"])
        for thickness, resistivity, wall in self.walls:
            ratio = hz / resistivity
            impedance = self.rho * self.c * (1 + (0.070 - 0.107j) * ratio**-0.632)
            porous_k = k * (1 + (0.109 - 0.160j) * ratio**-0.618)
            a -= scale * (1j * np.tan(porous_k * thickness) / impedance) * wall

        mechanical, electrical = [], []
        for driver in self.drivers:
            stiffness = 1 / driver["cms_m_per_n"]
            rear = driver["lumped_sealed_rear_chamber"]
            if rear is not None:
                stiffness += self.rho * self.c**2 * rear["projected_area_m2"] ** 2 / rear["volume_m3"]
            mechanical.append(driver["rms_n_s_per_m"] + s * driver["mmd_kg"] + stiffness / s)
            coil = driver["semi_inductance"]
            if coil is None:
                electrical.append(driver["re_ohm"] + s * driver["le_h"])
            else:
                admittance = 1 / coil["rss_ohm"] + 1 / (s * coil["le_h"]) + 1 / (np.sqrt(s) * coil["ke_semi_h"])
                electrical.append(coil["re_prime_ohm"] + s * coil["leb_h"] + 1 / admittance)

        ng, nn = self.trace.shape
        drivers, ports = m["drive"].shape
        # State order: interface flux coefficients, free chamber coordinates,
        # diaphragm velocities, and coil currents. BEAT factors and solves K.
        free = slice(ng, a.shape[0])
        vel = slice(free.stop, free.stop + drivers)
        amp = slice(vel.stop, self.rank)
        system = np.zeros((self.rank, self.rank), dtype=complex)
        pressure = np.zeros((self.rank, nn), dtype=complex)
        drive = np.zeros((self.rank, ports), dtype=complex)
        flux = np.zeros((len(self.faces), self.rank), dtype=complex)

        system[:ng, :ng] = m["gram"]
        system[:ng, free] = -a[:ng, ng:]
        system[:ng, vel] = scale * m["surface"][:ng]
        pressure[:ng] = -a[:ng, :ng] @ self.trace
        system[free, free] = a[ng:, ng:]
        system[free, vel] = -scale * m["surface"][ng:]
        pressure[free] = a[ng:, :ng] @ self.trace

        bl = np.diag([d["bl_n_per_a"] for d in self.drivers])
        system[vel, free] = -m["force"][ng:].T
        system[vel, vel] = np.diag(mechanical)
        system[vel, amp] = -bl
        system[amp, vel] = bl
        system[amp, amp] = np.diag(electrical)
        pressure[vel] = m["bem_force"][self.nodes].T - m["force"][:ng].T @ self.trace
        drive[amp] = m["drive"]
        flux[:, :ng] = m["flux"][self.faces]
        flux[:, vel] = scale * m["bem_velocity"][self.faces]

        outputs = np.eye(self.rank)[vel.start :]
        arrays = dict(
            k=system,
            c=pressure,
            b=drive,
            d=flux,
            e=np.zeros((len(self.faces), ports)),
            velocity=outputs[:drivers],
            current=outputs[drivers:],
            velocity_drive=np.zeros((drivers, ports)),
            current_drive=np.zeros((drivers, ports)),
        )
        return {key: np.asarray(value[None], dtype=np.complex64) for key, value in arrays.items()}
