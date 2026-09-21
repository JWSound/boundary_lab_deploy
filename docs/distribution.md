# Windows desktop distribution

The first target is Windows x64. The installer is per-user by default, and application
resources are separate from settings, logs, temporary solves, and compilation caches.

## Build

Use Python 3.13 x64, Node 20 or newer, Git, and a Windows build host. Prepare the project
virtual environment and run `npm ci` in `desktop/` first.

```powershell
.\.venv\Scripts\python.exe scripts/build_runtime.py
.\.venv\Scripts\python.exe scripts/verify_bundle.py --solve
cd desktop
npm run dist:win:unsigned
```

`build_runtime.py` downloads checksum-pinned official Python embeddable and Julia portable
archives, builds Deploy and the pinned BEAT wheel, installs version-pinned Python wheels,
and stages Julia package sources and selected artifacts (including lazy CUDA artifacts).
It retains upstream license files and records wheel hashes, component versions, and a full
resource inventory in `runtime-manifest.json`. It does not copy a development venv or the
whole user Julia depot. A completed output is immutable: use a new `--output` directory
for another staging build. The builder currently reads `build/resources`.

`npm run pack:win` creates `release/win-unpacked`. `npm run dist:win:unsigned` creates an
unsigned local-test NSIS installer. `npm run dist:win` requires signing credentials and
fails if signing is unavailable. Neither command publishes or configures automatic updates.
The pinned electron-builder 26 hook preserves signatures and hashes of vendor files in
extraResources; the application and installer remain the signing targets.
Unsigned builds skip executable resource editing because its bundled signing tool requires
Windows symlink privileges. They currently retain the default Electron executable icon.

## Runtime

Installed launches resolve Python and Julia from `process.resourcesPath`, use isolated UTF-8
Python, and ignore developer Python/Julia/BEAT environment overrides. No pip, Git, npm, or
Julia package installation runs on the end user's machine. Pattern preview remains usable
while the CUDA worker initializes. Boundary/Coupled currently require a compatible NVIDIA
driver for the pinned CUDA 13.3 runtime. The toolkit preference is bundled so a
different driver cannot trigger selection of an unbundled artifact. Driver installation is not part of this installer.

User-data layout:

- `runtime/<runtime-id>/julia-depot`: writable compilation caches.
- `tmp`: temporary requests/results managed by the worker.
- `logs/solver.log`: solver stderr, rotated on worker startup above 5 MiB.

The packaged depot is read-only by convention and follows the writable user depot. Julia
uses generic CPU compilation and limited precompilation concurrency. No developer-machine
compiled caches are shipped, so the first solver start can take longer than later starts.

## Verification and release limits

The relocation test copies resources to a directory containing spaces, clears developer
paths, blocks conventional HTTP(S) downloads through loopback proxies, enables Julia's
offline mode, starts the embedded worker, and optionally performs a two-package CUDA solve.
It verifies that installed resource hashes and file inventory remain unchanged. These tests
use the current machine's NVIDIA driver; they do not replace clean-machine validation on
other CPU/GPU/driver combinations.

Before public release: add production signing credentials and application artwork, qualify
cold starts on representative Windows hardware and a non-admin account, test upgrade and
uninstall against a prior release, and review redistributed third-party notices. Keep app,
BEAT, Python and Julia versions together as one qualified release. A custom Julia sysimage
and differential downloads can follow after measuring cold-start time and installer size.

### Current local candidate

The full offline bundle is approximately 3.3 GB before Electron and installer compression;
the unsigned installer is approximately 1.6 GB. A cold generic Julia cache took about four
minutes to compile on the development machine. Subsequent starts reuse the user's cache.
Reducing first-start latency with a tested, relocatable precompiled depot is a follow-up,
not something this candidate silently assumes from the developer's machine.

The packaged application supports a hidden `--packaged-smoke` diagnostic that loads the
bundled example and starts the embedded Python worker. It writes `packaged-smoke.json`
in its test user-data directory; `DEPLOY_SMOKE_DATA` selects that directory for tests only.
`verify_bundle.py --in-place --resources <installed resources> --solve` can additionally
check an installed payload without making another multi-gigabyte copy.

A guarded local lifecycle test is available as `powershell -File scripts/test_installer.ps1`.
It refuses to run if Deploy is already installed, installs only under this repository's
build directory, checks the packaged UI and embedded worker, and uninstalls that test copy.
It does not remove user projects or settings.

## Verified local candidate (2026-09-21)

- 55 Python regressions, runtime isolation tests, lint, and the desktop build passed.
- The final relocated runtime completed the two-package CUDA solve in offline mode:
  nine iterations, relative residual about 5.15e-5; installed files were unchanged.
- The packaged executable and the temporarily installed app both loaded the bundled
  example and started embedded Python with invalid developer executable overrides.
- A silent per-user installation and its registered uninstaller completed successfully;
  the temporary executable and uninstall registration were removed afterward.
- The reusable lifecycle harness was corrected for versioned uninstall display names,
  absent InstallLocation metadata, and silent-installer argument spacing.

Installer: `release/Boundary-Lab-Deploy-0.1.0-win-x64.exe` (1,594,778,560 bytes), unsigned.
SHA-256: `804242eb336aec9682c0c58ed2c2830ecb9c8530a560d61814542252523615b4`.
The same checksum is recorded in `release/SHA256SUMS.txt`.


## Qualification of hosted candidates

A GPU-less Windows build must register CUDA_Runtime_jll and CUDA_Compiler_jll in
its bundled Julia Project.toml extras and set both version preferences before
artifact selection. An app-ready check alone does not detect missing lazy CUDA
artifacts. The builder and relocation verifier now reject missing CUDA runtime,
compiler, BLAS, sparse, solver and CUDSS libraries. Candidate rc1 failed this
inventory qualification and is superseded by rc2; never promote rc1.

After downloading a candidate, verify SHA256SUMS.txt, install or extract it into a
fresh test location, and run `verify_bundle.py --in-place --solve` against its
resources on trusted NVIDIA hardware. This uses the bundled Python/Julia with an
isolated depot and disabled package downloads. Record its residual and runtime ID
before promoting a signed final build.
