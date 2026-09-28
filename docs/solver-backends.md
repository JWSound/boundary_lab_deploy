# Solver backends

Preferences (the top-right settings button) selects CPU or NVIDIA CUDA for Boundary and Coupled solves, microphone sweeps, and audience-plane updates. The choice is saved in `solver-preferences.json` under Electron's user-data directory, independently of projects.

On first launch, Deploy probes the CUDA engine's versioned worker handshake. It selects CUDA only when the worker reports that CUDA is available; otherwise it selects CPU. Later launches retain the saved choice. Selecting a backend is disabled during a running solve or sweep. Switching backends invalidates the desktop result identity and uses the corresponding engine worker.

The CPU coupled path uses the exported parity Petrov-Galerkin speaker ROM, the CPU exterior Burton-Miller operators, one exterior LU factorization per frequency, and a host-array GMRES feedback solve. It preserves the same ROM response, phasor convention, field reuse, and sweep warm-start contracts as CUDA.

## Development and release dependency

This feature requires the companion BEAT Engine `feat/deploy-cpu` implementation for CPU Coupled solving. BEAT 0.2.0 supports CPU Boundary solving but rejects CPU parity-ROM solves. The development environment can use an editable checkout of the companion engine.

Before releasing this Deploy feature, publish and qualify a new BEAT wheel, then update **both** `pyproject.toml` and `packaging/runtime-lock.json` with its immutable URL and SHA-256. Do not repoint the existing 0.2.0 release. Boundary Lab's independent engine pin does not need to change.

## Qualification

Run from the Deploy development environment:

```powershell
python scripts/check_solver_backends.py --output runs/backend-qualification --backend both
python scripts/smoke_solver.py --backend cpu --output runs/mixed-cpu
python scripts/smoke_solver.py --backend cuda --output runs/mixed-cuda
```

The first command runs Boundary and Coupled solves, cached field evaluation, and two-frequency sweeps, checks CPU/CUDA complex-pressure agreement within a relative norm tolerance of 0.0005, and checks coupled convergence and sweep warm starts. It writes request/result artifacts under the requested new directory. The mixed smoke commands use two different speaker packages.

Also run Python tests, the desktop build, `npm run test:runtime`, and `npm run test:editing-ui`. Engine changes require the Julia reference gate and CPU GMRES tests. Qualify the final installer on a machine without NVIDIA hardware before publishing; development CPU tests and a CUDA-hidden availability probe do not replace installed-runtime qualification.
