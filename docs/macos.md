# macOS development and unsigned packages

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

## Unsigned Apple-silicon test package

The macOS bundle includes checksum-pinned standalone CPython 3.13.16, Julia
1.12.6, the released BEAT wheel, and CPU/Metal packages and lazy artifacts from a
clean staging depot. `packaging/runtime-lock.json` records the platform downloads;
`requirements-macos.txt` pins the Python dependencies. The generated runtime
manifest records wheel hashes, every resource hash, and relative symlinks.
No system Python, Julia, Homebrew or developer depot is required by the app.

Build on native Apple silicon with Python 3.12+ and Node 20. The output directory
must be empty; keep older builds elsewhere instead of overwriting their manifest.

```sh
.venv/bin/python scripts/build_runtime_macos.py
cd desktop
npm ci
npm run dist:mac:unsigned
cd ..
.venv/bin/python scripts/test_installer_macos.py \
  --dmg release/Boundary-Lab-Deploy-0.1.0-rc.4-mac-arm64-unsigned.dmg \
  --qualify-backends
```

Use `npm run pack:mac` for an unpacked `.app`. The DMG is an **unsigned internal
test artifact**, not a notarized public release. Gatekeeper may block a downloaded
copy. Do not disable Gatekeeper globally. Intel macOS packaging is not included.

The installer test mounts the DMG read-only, copies the app into a fresh path
containing spaces, unmounts the image, and launches the packaged renderer and
worker with invalid development executable overrides. It then performs an offline
CPU solve with only system utilities on PATH. `--qualify-backends` additionally
requires a physical Metal device and compares CPU/Metal boundary and coupled/ROM
solves, cached fields, and warm-start sweeps in the mixed close-ground scene.
Installed resources must retain their manifest hashes. Test data remains outside
the `.app`, in `build/Mac Installed Test`; choose another `--destination` for a
new run. Per-user runtime caches are versioned by the bundle's runtime ID.

The manually dispatched **macOS unsigned candidate** workflow builds a test DMG
only from a commit with successful main CI. It tests the copied app and offline
CPU solve, then uploads the DMG, runtime manifest, checksums and reports as Actions
artifacts. Hosted macOS runners do not qualify physical Metal execution.

## Public distribution still required

Before a public macOS release, configure Developer ID signing and notarization,
including the bundled Python/Julia native code and JIT entitlements, and establish
a post-signing resource inventory policy (signing changes Mach-O bytes). The
unsigned configuration deliberately skips signing and notarization and does not
publish a GitHub release. A branded app icon and qualification of a quarantined,
notarized download on a clean Mac also remain. Signed release artifacts must be
qualified separately; an unsigned test does not establish Gatekeeper acceptance.

Upstream references: [standalone Python distributions](https://github.com/astral-sh/python-build-standalone/releases/tag/20261003),
[Julia 1.12.6 checksums](https://julialang-s3.julialang.org/bin/checksums/julia-1.12.6.sha256),
and [electron-builder v26 macOS configuration](https://www.electron.build/v26/docs/mac/).
