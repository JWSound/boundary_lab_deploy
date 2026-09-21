# Boundary Lab Deploy

Standalone desktop application for loudspeaker-array placement, coverage, and loading analysis.
The Electron/React application is in `desktop/`; its Python worker is in `src/boundary_deploy/`.
Boundary Lab is the speaker-package authoring application, not a runtime dependency.
Deploy reads portable `.blabsp` packages and stores `.blabdeploy.json` projects.

## Development setup (Windows)

From this repository:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
$env:DEPLOY_PYTHON_EXE = (Resolve-Path .venv/Scripts/python.exe).Path
cd desktop
npm ci
npm run build
npm start
```

Use `npm run dev` for development. Pattern preview needs no Python or Julia solve runtime.
Boundary/Coupled require Julia and the BEAT Julia environment for the selected backend.
The desktop currently requests CUDA; it does not automatically fall back to CPU.
Set `DEPLOY_JULIA_EXE` and optionally `DEPLOY_JULIA_THREADS` if Julia is not on PATH.
Legacy `BLAB_PYTHON_EXE` / `BLAB_JULIA_EXE` / `BLAB_JULIA_THREADS` remain accepted.
Prepare the engine runtime explicitly with `.\.venv\Scripts\python.exe -m beat_engine instantiate --backend cuda`
from the repository root. Julia package setup may download dependencies on a fresh machine.

After setup, `powershell -File scripts/start.ps1` launches the standalone app.

No `PYTHONPATH` injection or Boundary Lab checkout is required.

The BEAT dependency is pinned to a published wheel and SHA-256 in `pyproject.toml`.
The bundled runtime uses the same pin in `packaging/runtime-lock.json`. BEAT 0.2.0
includes the mixed-package schema 3 support required for Coupled solves.

Development against a candidate engine must be explicit and use a unique version
in a separate virtual environment. Such results do not certify the released pin.
Restore the declared dependency before validating a release build.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest tests
.\.venv\Scripts\python.exe -m ruff check src tests
cd desktop
npm run build
npm run test:viewport
npm run test:placement
npm run test:pattern
npm run test:package
```

See [the user guide](desktop/docs/user-guide.md), [system model](desktop/docs/system-model.md),
and [extraction notes](docs/extraction.md). Desktop installer/runtime bundling is a subsequent
milestone; this repository currently supports source installation.

For an opt-in numerical check, run `.\.venv\Scripts\python.exe scripts/smoke_solver.py --backend cuda`.
This validates two different bundled packages at one common frequency and two pressure probes.

Windows bundle and installer instructions: [distribution guide](docs/distribution.md).

## Contributing and releases

Use scoped PRs targeting `main`. See [contributing](CONTRIBUTING.md) and the
[release process](docs/development.md). Stable releases are independent of main.
