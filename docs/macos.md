# macOS development and packages

Deploy's Metal path targets Apple Silicon with macOS 14 or newer, native ARM64
Python 3.11+, and Julia 1.12. Node/npm are needed to build the Electron desktop.
Intel Macs can use CPU; they are not a Metal target.

The BEAT 0.5.1 hotfix wheel supports Deploy Metal and is SHA-256 pinned in
both `pyproject.toml` and `packaging/runtime-lock.json`. Until that wheel is
published, use the exact local candidate as described below. Automatic selection uses
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

For prepublication engine qualification, `build_runtime_macos.py --engine-wheel
build/engine-hotfix/beat_engine-0.5.1-py3-none-any.whl` uses a local copy only if
its filename and SHA-256 exactly match the release pin. Deploy's development
environment can install the same wheel with `pip install --no-deps <wheel>`.
The pinned GitHub URL requires publishing that exact wheel before clean CI or
normal source installs can use it. The 0.5.1 hotfix makes Metal imports mandatory
for the Metal engine bundle and checks live worker/device availability before
accepting a Metal solve. A new runtime ID isolates caches from older bundles.

The installer test mounts the DMG read-only, copies the app into a fresh path
containing spaces, unmounts the image, and launches the packaged renderer and
worker with invalid development executable overrides. It then performs an offline
CPU solve with only system utilities on PATH. `--qualify-backends` additionally
requires a physical Metal device and compares CPU/Metal boundary and coupled/ROM
solves, cached fields, and warm-start sweeps in the mixed close-ground scene.
Installed resources must retain their manifest hashes. Test data remains outside
the `.app`, in `build/Mac Installed Test`; choose another `--destination` for a
new run. Per-user runtime caches are versioned by the bundle's runtime ID.
The hidden renderer smoke profile suppresses the first-use informational dialog
so the native modal loop cannot stall automation. Numerical qualification uses a
separate fresh depot and still exercises first-time solver initialization.

The manually dispatched **macOS unsigned candidate** workflow builds a test DMG
only from a commit with successful main CI. It tests the copied app and offline
CPU solve, then uploads the DMG, runtime manifest, checksums and reports as Actions
artifacts. Hosted macOS runners do not qualify physical Metal execution.

## Signed and notarized local candidate

Install a Developer ID Application certificate with its private key and Apple's
Developer ID G2 intermediate in your login keychain. Confirm that
`security find-identity -v -p codesigning` lists the valid identity. Store
notarization credentials interactively; never put the password in shell history,
the repository, or build logs:

```sh
xcrun notarytool store-credentials boundary-lab-deploy-notary \
  --apple-id YOUR_APPLE_ID_EMAIL --team-id YOUR_TEAM_ID
```

With a current staged runtime, run on native Apple Silicon with Python 3.11+:

```sh
.venv/bin/python scripts/release_macos.py \
  --identity YOUR_CERTIFICATE_SHA1_FINGERPRINT --qualify-backends
```

Alternatively, set `DEPLOY_MAC_SIGN_IDENTITY` to the fingerprint and run
`npm run dist:mac:signed` from `desktop` (uses `python3`; pass
`-- --qualify-backends` for the physical Metal gate). The command accesses the
local signing key and uploads the complete DMG to Apple's notarization service.
It never publishes a GitHub release. Output goes into a fresh timestamped
`release/signed-*` directory; `--output` selects another new directory.
Use `--resources build/resources-metal-cache` to package a separately staged
hotfix without replacing the previous staging directory.

The signed builder configuration requires a distribution identity and hardened
runtime. Its `afterPack` hook verifies the copied runtime against the unsigned
manifest, signs Mach-O executables/libraries/extensions with secure timestamps,
and preserves the original manifest as `runtime-manifest-unsigned.json`. The
replacement manifest inventories signed bytes and records the source runtime ID,
source manifest digest, identity and signed paths. A new signed runtime ID keeps
user caches separate. Staged `build/resources` is never modified by signing.
Electron then signs its frameworks/helpers and seals the application, skipping
the already signed runtime so inventory hashes remain valid.

Electron receives JIT permission. Julia additionally receives unsigned executable
memory and library-validation exceptions for its code generation and locally
generated native package caches. Python and native libraries receive no added
entitlements. These settings must be qualified on the actual signed app; they
are not established by unsigned runtime tests.

The release command signs the DMG and first runs the installer test with
`--verify-signatures`, which verifies the copied app and native runtime signatures
before launching the renderer/worker and running the offline CPU solve.
`--qualify-backends` adds the physical CPU/Metal comparison, first with an empty
cache and then on a warm relaunch without prewarming or repairing caches.
Only after these tests pass does the command submit using the Keychain profile,
save the submission ID and Apple's log, staple the accepted ticket, and check
Gatekeeper for both the DMG and copied app. A final SHA256SUMS.txt is written only
after success. `test_installer_macos.py --signed` also requires Gatekeeper
acceptance when independently testing an already notarized candidate.
Notarization results remain in the candidate directory, including failures.
If Apple is still processing after 20 minutes, resume without rebuilding:

```sh
.venv/bin/python scripts/release_macos.py \
  --resume-dmg 'release/signed-TIMESTAMP/Boundary-Lab-Deploy-0.1.0-rc.4-mac-arm64.dmg' \
  --qualify-backends
```

The receipt binds the submission to the DMG checksum. Do not edit a signed app,
its runtime manifest, or an existing candidate; rebuild into a new directory.
The unsigned candidate CI remains credential-free. Signing in CI would require
a protected release environment, temporary keychain and separately provisioned
secrets; this local workflow does not configure those services.

Before public distribution, qualify a quarantined browser download on a clean
Mac, including offline launch. Local Gatekeeper assessment alone does not replace
the clean-machine download check.

Upstream references: [standalone Python distributions](https://github.com/astral-sh/python-build-standalone/releases/tag/20261003),
[Julia 1.12.6 checksums](https://julialang-s3.julialang.org/bin/checksums/julia-1.12.6.sha256),
and [electron-builder v26 macOS configuration](https://www.electron.build/v26/docs/mac/).
