# Repository extraction

Copied from Boundary Lab commit 28f6f1d2372481c55bc5f0af3e01b90b5cb7ffba.
The original repository is preserved during migration. This is a fresh local repository,
not a history rewrite; LICENSE and original source attribution are retained.

- `deploy/` becomes `desktop/`.
- `src/blab/deploy/` becomes `src/boundary_deploy/`.
- Deploy's reader-side checksum/schema validator and phasor helpers are independent.
- The worker calls BEAT Engine directly. It owns and terminates its own workers.
- `.blabsp` schema 1 and `.blabdeploy.json` remain unchanged; exporters remain in Boundary Lab.
- Optional viewport assets remain display-only. Acoustic mesh and ROM payloads are unchanged.
- Authoring/ROM-training research scripts remain in Boundary Lab for now. Historical desktop
  benchmarks are retained as records, not portable executable test fixtures.

Next release milestones: package/provision Python and
Julia, installer resource paths and writable cache locations, signed release builds, and move
ongoing Deploy development here after compatibility is accepted. No remote has been created.

## Engine compatibility

Published BEAT 0.1.4 accepts Deploy schemas 1 and 2 only. Mixed-package Coupled
requires schema 3. The dependency is therefore pinned to public BEAT commit `6f2883e3a5d9cd5e6e275e172c0e605207d945e1`
rather than an editable local checkout or an incompatible release. Its Python version
metadata still reads 0.1.4; record the commit as well when reproducing results.

## Local verification (2026-09-21)

- A fresh isolated virtual environment has no Boundary Lab, Qt, or editable BEAT checkout.
- 55 Python tests pass, including worker launch from an unrelated directory with no
  PYTHONPATH and an import guard that rejects any `blab` dependency.
- The desktop build and viewport, placement, Pattern, channels, analysis, phasor, and
  package checks pass using independently installed npm dependencies.
- A real CUDA mixed-package Coupled solve used bundled S218BP and SKHORN packages:
  2,072 nodes, 4,136 faces, two pressure probes, nine iterations, residual 5.15e-5.
  Results are in ignored `runs/standalone-mixed-smoke/`; this is a bounded smoke check,
  not full-band numerical qualification.
- Python wheel build and `pip check` pass; all 55 tests also pass against the
  non-editable wheel. The development environment was then restored to editable mode.
- The standalone Electron smoke test passes with no console errors; it loads a project
  containing two speakers and one rigid mesh, exercises import and editing, and cancels
  a microphone sweep successfully.
- Two inherited smoke fixtures needed corrections: an off-center cabinet must rotate
  toward its neighbor to test collision prevention; rigid-mesh IDs must be computed
  from fixture bytes because checkout line endings affect their hash.

No Boundary Lab or BEAT source files were changed. No remote repository was created.
