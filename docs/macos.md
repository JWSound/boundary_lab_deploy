# macOS source development

Deploy's Metal path targets Apple Silicon with macOS 14 or newer, native ARM64
Python 3.11+, and Julia 1.12. Node/npm are needed to build the Electron desktop.
Intel Macs can use CPU; they are not a Metal target.

The checked-in BEAT 0.5.0 wheel supports Deploy Metal and is SHA-256 pinned in
both `pyproject.toml` and `packaging/runtime-lock.json`. Automatic selection uses
Metal only when the device is functional and the engine advertises Deploy Metal
support; otherwise it falls back to CPU.

## Source setup

Use a separate native ARM64 environment with the published dependency:

```sh
python3 -m venv .tmp/metal-venv
.tmp/metal-venv/bin/python -m pip install -e '.[dev]'
.tmp/metal-venv/bin/python -m beat_engine instantiate --backend cpu
.tmp/metal-venv/bin/python -m beat_engine instantiate --backend metal
.tmp/metal-venv/bin/python -m beat_engine doctor --backend metal --threads 2
cd desktop
npm ci
npm run build
cd ..
DEPLOY_PYTHON_EXE="$PWD/.tmp/metal-venv/bin/python" sh scripts/start.sh
```

Set `DEPLOY_JULIA_EXE` to the Julia executable if it is not on PATH.
First launch selects Metal only when both the device and Deploy capability are
available. A previously saved CPU preference stays CPU; change it in Preferences.
Metal compilation can make first startup and the first solve slower than later
requests. Pattern preview does not require a solver.

The implementation uses Metal BEM operator assembly and field evaluation, CPU
near-pair corrections (including ground images), and CPU dense LU. Coupled mode
reuses the host speaker-ROM GMRES feedback solve and frequency warm starts.
The effective assembly is `operator_matrices`, including when a caller requests
`direct_system`; the fused Metal path is not yet used by Deploy. Complex pressure,
speaker velocity/current, and cached audience-plane updates are preserved.

## Qualification

Run on a real Metal device using the source environment:

```sh
.tmp/metal-venv/bin/python scripts/check_solver_backends.py --backend cpu-metal --output runs/metal-single
.tmp/metal-venv/bin/python scripts/check_solver_backends.py --backend cpu-metal --scene mixed-close-ground --output runs/metal-close-ground
.tmp/metal-venv/bin/python scripts/smoke_solver.py --backend metal --output runs/metal-mixed
```

Each output directory must be new. The comparison covers Boundary and Coupled,
complex pressure, cached field evaluation, two-frequency sweeps, ROM convergence,
and warm starts. The mixed scene places S218BP and SKHORN cabinets 25 mm apart and
5 mm above ground, and asserts that both direct and ground-image correction pairs
are exercised. CPU/accelerator relative pressure tolerance remains `5e-4`.
BEAT 0.5.0 passed these integration gates on physical Apple M4 hardware before
publication; rerun them when changing the engine or runtime bundle.

Also run Python tests/lint, the desktop build, and `npm run test:runtime`.
The engine has a separate Metal near-correction hardware gate and CPU reference
gate. macOS CI covers Python and desktop behavior; a virtual macOS runner does
not replace numerical qualification on physical Apple Silicon.

## Distribution still required

This is source support. The existing runtime builder and Electron installer
configuration target Windows. A macOS release still needs a checksum-pinned
ARM64 Python/Julia bundle, staged CPU/Metal artifacts, platform-specific runtime
paths, offline relocation checks, macOS signing/notarization, and installed-app
qualification. The engine dependency is released and pinned; certify the packaged
runtime separately before distributing a Deploy release.
