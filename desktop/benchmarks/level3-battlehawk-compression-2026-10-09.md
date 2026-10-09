# Battlehawk CUDA feedback compression spike — 2026-10-09

## Result

The opt-in block-low-rank prototype preserves the tested solution accurately,
but does **not** speed up a fresh solve. On the saved 16-cabinet scene at
32.474918365478516 Hz, three interleaved measured runs give a median worker
request time of **36.20 s for exact matrix-free feedback and 155.40 s for the
prototype**. The prototype's feedback application is fast; its construction
is too expensive. It remains experimental and disabled by default.

| Section | Existing CUDA path, median | Compressed feedback, median |
|---|---:|---:|
| Worker request | 36.195 s | 155.396 s |
| Worker request range | 36.178–36.463 s | 154.844–163.765 s |
| Exterior assembly | 6.550 s | 6.585 s |
| Exterior LU | 4.761 s | 4.809 s |
| Feedback RHS applications, all GMRES iterations | 21.992 s | 0.057 s |
| Compression construction and packing | — | 138.580 s |
| Complete Schur GMRES | 22.283 s | 0.369 s |

These are nested timing sections, not additive independent totals. The
prototype also pays for an independent exact-feedback residual audit. Both
modes rebuild their operators for every request. Startup and the shared Python
preparation (10.550 s) are outside the worker-request timer. This is not a
desktop click-to-display benchmark. Both modes received one warm-up before the
three measured pairs, in the same persistent worker. No other research solve
or test suite ran during the measured pairs.

## Scene and machine

* Source: `G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json`.
* Sixteen HSD Battlehawk instances, two columns of eight; no rigid objects.
* Original placements, channel EQ, gain, delay, polarity and selected frequency
  preserved. Saved channel/system gain produces +8 dB effective source gain.
* Each cabinet has 1,734 pressure nodes, 3,464 flux faces and two rank-32 ROM
  sectors. The combined exterior has 27,744 nodes and 55,424 faces.
* Exact complex-FP32 `L` storage is 5.735 GiB; a dense `R` would need 11.457 GiB.
* Windows 11; Ryzen 7 5700X; RTX 2080 Ti, 11,264 MiB; driver 596.49;
  Julia 1.12.6; Python 3.13.13. Julia and OpenBLAS environment thread counts: 4.
* Base source revisions: BEAT Engine `1e8c581`, Deploy `73d6cf1`, plus retained
  working-tree diffs and source snapshots. Python explicitly imports both
  checkouts; Julia bundle loading is disabled for the edited engine.

## Numerical checks at the saved frequency

The compression tolerance is `1e-4`, leaf size 128, admissibility multiplier 4,
and rank cap 64. Near blocks stay exact. Each accepted low-rank block has its
actual reconstructed Frobenius error checked; rejected compression stays dense.
The exact exterior LU and speaker ROMs are unchanged.

Across all three measured pairs:

* Microphone complex-pressure relative L2 error: at most `1.642e-6`.
* Diaphragm-velocity relative L2 error: at most `3.021e-6`.
* Voice-coil-current relative L2 error: at most `2.838e-6`.
* Both saved audience planes pass: 29,415 horizontal-plane samples and 6,270
  retained vertical-plane samples after below-ground clipping.
* Plane relative L2 errors: `1.797e-6` and `2.025e-6`. Maximum magnitude errors
  within 30 dB of each plane's reference peak: `0.0000824` and `0.0003014` dB.
* Each compressed solve passes the independent exact-quadrature,
  left-preconditioned residual gate (`1e-3`), as well as its own GMRES gate.

This isolates added compression error relative to the current dense CUDA/ROM
path. It does not establish mesh convergence, package-ROM accuracy, arbitrary
drive-pattern accuracy, or full-band qualification.

A separate one-cabinet Float32 CPU reference agrees with the dense CUDA
baseline: microphone-pressure, velocity and current relative L2 errors are
`2.043e-6`, `1.664e-6` and `1.194e-6`, respectively. This is an independent
small-case backend check, not a CPU solution of the entire 16-cabinet scene.

Reference field-only requests took 1.476 s and 0.505 s for the two saved planes;
candidate field-only requests took 1.784 s and 0.530 s. These single observations
are not a field-evaluation performance comparison. They establish that the
audience grids were checked separately from boundary solving.

The separate **250 Hz upper-edge accuracy check also passes** for all 16
cabinets and both planes. Plane relative L2 errors are `9.360e-6` and
`1.375e-5`; worst magnitude errors above the −30 dB cutoff are `0.0008984` and
`0.001258` dB. The exact-feedback audit residual is `1.143e-4`, below its
`1e-3` acceptance gate; compressed GMRES reports `6.759e-5` in 13 iterations.
The packed operator occupies 3,239,108,948 bytes (about 3.02 GiB). This run was
for accuracy only, concurrent with CPU reference work, and its timings are
excluded from performance conclusions. Two checked frequencies do not qualify
the entire 20–250 Hz band.

## Storage and failed configurations

The successful configuration has 25,413 blocks, including 9,877 compressed
blocks. Values occupy 2.613 GiB; packed GPU values and indexing occupy
**2.774 GiB**, about 4.13 times smaller than dense `R`. Dense near blocks account
for 1.357 GiB and far-block factors for 1.256 GiB. The largest accepted rank is
40; every block remains within the requested error tolerance.

Device-wide sampled GPU memory peaked at 10,645 MiB across the study, including
other applications and warm-up. One-second sampling can miss brief peaks; host
peak memory was not collected. Individual reports record available GPU memory
before upload. The final builder reclaims unused CUDA pool buffers before its
VRAM guard, retaining the live LU and geometry.

Earlier configurations are retained, not discarded:

| Admissibility | Outcome |
|---|---|
| 1 | Guard rejected 5,308,555,340 packed bytes; near values alone used 4.140 GiB. |
| 2 | Guard rejected 3,477,353,704 packed bytes before pool reclamation was added. This does not prove it cannot fit after reclamation. |
| 4, with pool reclamation | 2,978,338,636 packed bytes; full solve and field checks passed. |

The initial unbatched prototype also exposed excessive small-kernel overhead:
four cabinets spent about 8.07 s applying blocks. The final path packs all
dense/low-rank data and applies it in two GPU kernels. Those initial small-case
trials are correctness/debug evidence, not repeat-qualified speed claims.

## Rank survey and next experiment

A 32-block spatial survey of the full scene found ranks 4–9 at 32.47 Hz and
6–11 at 250 Hz among the 21 geometrically separated sampled blocks, at `1e-4`
SVD Frobenius tolerance. This sample did not predict whole-operator storage;
the full build's near blocks and larger admissible clusters matter.

The next priority is construction, before attempting hierarchical LU:

1. Reuse exact singular/near/image correction values within a frequency. This
   prototype recomputes them for every one of its 512 column slabs.
2. Build admissible factors from sampled entries/blocks, instead of assembling
   all dense entries and compressing them on the CPU.
3. Compare a narrower alternative: project `R` onto the existing speaker-ROM
   flux basis. The 16 speakers provide at most 1,024 feedback coordinates, so
   `R` times that basis would occupy about 216.75 MiB in complex FP32. That is
   an unimplemented estimate, not a measured optimization or speed claim.

The measured feedback saving is roughly 22 s per request. Construction must
fall below that saving (including audits and overhead) to improve this fresh
solve. Simply enabling the present prototype would make the application slower.

## Reproduction and retained artifacts

See the engine's `docs/ExperimentalDeployCompression.md` for numerical details
and commands. Deploy scripts:

* `scripts/research_deploy_compression.py`: scene validation/preparation,
  rank-survey and interleaved worker replay, optional field-plane checks.
* `scripts/compare_deploy_compression.py`: requires a completed study and
  checks compatible finite complex outputs and convergence before reporting.

Local, uncommitted artifacts are under `runs/compression-spike/`:
`baseline-initial` (sandbox failure), `baseline-retry`, `rank-survey`,
`prototype-small`, `packed-16` and `packed-16-eta2` (VRAM guards), and
`packed-16-eta4` (three-run comparison and plane checks). `hardware.json`
records the machine. Each study retains requests, events, source provenance,
rank reports and raw results. Generated artifacts must not be committed.

`cpu-reference-one` and `cpu-reference-comparison.json` retain the real-package
CPU check; `upper-band-accuracy` retains the 250 Hz check and concurrency note.
The focused CUDA regression suite passes 33 assertions, including
both phasor conventions, ground images/near corrections, exact selected-column
agreement, and packed dense/low-rank/zero-rank application. The two Python
replay/comparison tests and both repositories' requested Ruff checks pass.
The required standalone Julia reference suite completed with process exit 0;
its captured log and exit status are retained as `reference-final.log` and
`reference-final-exit.json` in the study root. Frozen numerical baselines were
not changed.
