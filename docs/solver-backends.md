# Solver backends

Preferences (the top-right settings button) selects CPU, NVIDIA CUDA, AMD ROCm, or Apple Metal for Boundary and Coupled solves, microphone sweeps, and audience-plane updates. The choice is saved in `solver-preferences.json` under Electron's user-data directory, independently of projects. ROCm requires an engine candidate advertising Deploy ROCm support; the currently pinned 0.5.1 wheel does not provide this path. Metal requires an engine candidate with Deploy Metal support; see [macOS development](macos.md).

On first launch, Deploy probes the native accelerator's versioned worker handshake: Metal on Apple Silicon, CUDA then ROCm on Windows/Linux, CPU on Intel Macs. Metal and ROCm must advertise Deploy solver support as well as a functional device and required solver libraries. Unavailable accelerators fall back to CPU. Later launches retain the saved choice. Selecting a backend is disabled during a running solve or sweep. Switching backends invalidates the desktop result identity and uses the corresponding engine worker.

The CPU coupled path uses the exported parity Petrov-Galerkin speaker ROM, the CPU exterior Burton-Miller operators, one exterior LU factorization per frequency, and a host-array GMRES feedback solve. It preserves the same ROM response, phasor convention, field reuse, and sweep warm-start contracts as CUDA.

The ROCm path assembles native boundary operators and evaluates fields on the AMD
GPU. Boundary and Coupled solves use one ComplexF64 rocSOLVER factorization per
frequency; requested-precision operators remain resident during repeated solves.
Coupled ROM response and GMRES vectors remain on the host, with the GPU factors
reused for every feedback application. Cached audience fields and frequency-sweep
geometry use backend-specific caches. CUDA-specific projected/compressed RHS and
factor-reuse experiments remain CUDA-specific; they are not required for the
standard CPU/ROCm workflows.

The desktop shows separate RAM and VRAM estimates for ROCm's retained operators
and Float64 factors. These are uncalibrated working-set ranges. AMD VRAM capacity
is not currently queried by the desktop memory guard; it does not use NVIDIA
capacity as a substitute. Runtime qualification is still required for each target
GPU/driver configuration.

## Development and release dependency

This feature requires BEAT Engine 0.3.0 for CPU Coupled solving. BEAT 0.2.0 supports CPU Boundary solving but rejects CPU parity-ROM solves. The development environment can use an editable checkout of the companion engine.

Before releasing this Deploy feature, publish and qualify a new BEAT wheel, then update **both** `pyproject.toml` and `packaging/runtime-lock.json` with its immutable URL and SHA-256. Do not repoint the existing 0.2.0 release. Boundary Lab's independent engine pin does not need to change.

## Qualification

Run from the Deploy development environment:

```powershell
python scripts/check_solver_backends.py --output runs/backend-qualification --backend both
python scripts/check_solver_backends.py --output runs/rocm-qualification --backend cpu-rocm
python scripts/check_solver_backends.py --output runs/rocm-mixed --backend cpu-rocm --scene mixed-close-ground
python scripts/smoke_solver.py --backend cpu --output runs/mixed-cpu
python scripts/smoke_solver.py --backend cuda --output runs/mixed-cuda
```

The first command runs Boundary and Coupled solves, cached field evaluation, and two-frequency sweeps, checks CPU/CUDA complex-pressure agreement within a relative norm tolerance of 0.0005, and checks coupled convergence and sweep warm starts. It writes request/result artifacts under the requested new directory. The mixed smoke commands use two different speaker packages.

The `cpu-rocm` commands apply the same comparisons to ROCm, including complex
diaphragm velocity and coil current. They also verify capability negotiation and
actual ROCm dense-solver/factor-precision/field diagnostics. The mixed scene
exercises near corrections between different cabinets and their ground images.

Also run Python tests, the desktop build, `npm run test:runtime`, and `npm run test:editing-ui`. Engine changes require the Julia reference gate and CPU GMRES tests. Qualify the final installer on a machine without NVIDIA hardware before publishing; development CPU tests and a CUDA-hidden availability probe do not replace installed-runtime qualification.

To qualify relocated or installed resources using bundled Python and Julia with
network access disabled:

```powershell
python scripts/verify_bundle.py --resources build/resources --solve --qualify-backends
```

For an existing installation, pass its resources directory and `--in-place`.
`--solve` covers mixed speaker packages; `--qualify-backends` exercises both
backends, both fidelities, cached fields, and warm-start sweeps. Verification also
checks that no installed resource changed during execution.

After building the installer, `./scripts/test_installer.ps1 -QualifyBackends`
installs it into a guarded temporary directory, verifies app launch and offline
CPU/CUDA numerical execution, then uninstalls that test copy. It refuses to
replace an existing Deploy installation.
