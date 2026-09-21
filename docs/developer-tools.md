# Offline solver developer tools

These tools moved from Boundary Lab after Deploy became standalone. Install Deploy
with `python -m pip install -e ".[dev]"`; invoke each script with `--help` for its
arguments. They use the pinned BEAT Engine package and never import Boundary Lab.
Actual runs require Julia and the selected working CPU/CUDA backend.

- `scripts/benchmark_deploy_level3.py`: compare deployment solve configurations.
- `scripts/build_speaker_rom_package.py`: exploratory exact-package to parity-ROM conversion.
- `scripts/experiment_speaker_rom_rank.py`: rank/training experiments.
- `scripts/validate_deploy_speaker_rom.py`: compare exact and ROM results at one frequency.
- `scripts/validate_deploy_speaker_rom_band.py`: compare results across a band.

The supported project-to-speaker export UI and CLI remain in Boundary Lab.
These tools operate on existing packages; they do not replace that export workflow.
Generated runs remain ignored. Historical benchmarks remain in `desktop/benchmarks`.
Consumer compatibility tests use small committed exporter outputs described in
`tests/fixtures/speaker-packages/README.md`, rather than another application's checkout.
