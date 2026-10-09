# Experimental ROM-projected CUDA feedback — 2026-10-09

This follows the [block compression spike](level3-battlehawk-compression-2026-10-09.md).
The opt-in `projected` mode precomputes the exterior RHS operator only on the
flux range of the existing exported speaker ROM. It introduces no new model
reduction. This is an experimental engine path, not a desktop release or a
change to automatic solver selection.

## Result and recommendation

The warmed 16-cabinet solve request at 32.474918365478516 Hz falls from a median
36.60 s to 22.65 s: **1.62× faster, or 38.1% less time**, including projection
construction and the independent audit. All three paired comparisons and both
audience planes pass. This is a useful improvement and warrants further work
on the projected path before investing in general hierarchical RHS compression.

| Measured section | Existing matrix-free feedback | ROM-projected feedback |
|---|---:|---:|
| Worker request median | 36.602 s | 22.654 s |
| Worker request range, 3 runs | 36.409–37.752 s | 22.459–22.744 s |
| Exterior assembly median | 6.524 s | 6.556 s |
| Exterior LU median | 4.760 s | 4.776 s |
| Feedback operator build median | — | 5.844 s |
| Feedback RHS applications, total median | 22.120 s | 0.00456 s |
| GMRES median | 22.432 s | 0.177 s |
| Independent audit median | — | 2.509 s |

One warm-up per mode is excluded, followed by three interleaved measured pairs
in a persistent worker. No other research solves or tests ran during the timing
study. Shared Python scene preparation took 15.311 s outside the request timer;
worker startup is also outside it. These numbers are not desktop click-to-display
latencies. Full audience-plane evaluation is outside the coupled-request timer
and is compared separately after each mode's final repeat.

Median construction comprises 5.562 s exact column assembly and 0.061 s CUDA
projection; the remaining approximately 0.22 s includes allocation/reclamation,
basis preparation and dispatch. The sampled device-wide peak was 8,285 MiB
over the whole study, including warm-ups (288 samples); this is neither exact
peak memory nor a process-attributed measurement.

The next engineering steps are broader scene/package qualification, safe slab
sizing for larger cabinets, and measured automatic selection against existing
feedback modes. Reuse of unchanged geometry/frequency factors is another
candidate for interactive updates. Dense exterior assembly and LU already
account for about 11.3 s and remain necessary targets for substantially larger
scenes. No production/default enablement is justified by this one-scene spike.

## Method and scope

Replay `G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json`
with its 16 HSD Battlehawk sources, saved placements, channel DSP and microphone.
Evaluate both saved audience planes after the final solve of each mode.
The scene and speaker package remain unchanged. Validation and package SHA-256
checks precede each study. Numerical code lives in BEAT Engine; the Deploy
research harness uses its public worker API.

For zero-drive feedback, the package already expresses flux as `q = U state(p)`.
Assemble exact `R` columns cabinet by cabinet and compute `T = R U` with CUDA
matrix multiplication. Retain `T` and discard each temporary dense slab. GMRES
uses `T state(p)` with the existing dense exterior LU. Initial drive, final
speaker response and field evaluation use their existing implementations.
The independent exact-quadrature, left-preconditioned residual audit remains
enabled and is included in the candidate solve time. Floating-point operation
ordering changes; this is not bit-identical arithmetic.

The 27,744-node / 55,424-face scene has 64 ROM coordinates per cabinet: `T`
contains 27,744 × 1,024 ComplexF32 values, 227,278,848 bytes (216.75 MiB).
The full dense `R` would use 11.46 GiB; the previous packed approximation used
2.77 GiB at 32.474918365478516 Hz. Exterior LU still occupies about 5.73 GiB.
The largest Battlehawk cabinet slab uses 768,841,728 bytes (about 733 MiB).

## Reproduction and artifacts

From the Deploy checkout:

```powershell
$env:PYTHONPATH='E:/Code/boundary_lab_deploy/src;E:/Code/BEAT_Engine/src'
python scripts/research_deploy_compression.py 'G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json' --output runs/compression-spike/projected-16-performance --counts 16 --modes matrix_free,projected --warmup 1 --repeat 3 --field-planes
python scripts/compare_deploy_compression.py runs/compression-spike/projected-16-performance --candidate projected
```

Runtime: RTX 2080 Ti (11 GiB), Ryzen 7 5700X, Windows 11, Julia 1.12.6,
Python 3.13.13, four Julia/BLAS threads. Worker wall time includes per-request
geometry/setup and transport, excluding shared Python preparation and worker
startup. Timing sections are nested and must not be summed indiscriminately.
Only warmed, interleaved repeated measurements support performance conclusions.

Artifacts live under `runs/compression-spike/` and are not committed:

- `projected-small`: preserved sandbox EBADF / temporary-folder failure.
- `projected-small-retry`: one-cabinet accuracy comparison; cold/concurrent
  timings excluded from performance claims.
- `projection-cpu-comparison.json`: comparison to the retained one-cabinet
  CPU reference from the first spike.
- `projected-upper-accuracy`: stopped during cabinet 7 after severe GPU-memory
  pressure. Shared CUDA aliases kept temporary slab storage alive until GC.
  The selected-column assembler now explicitly releases intermediate aliases
  and original slab storage after creating the returned matrix view.
- `projected-upper-retry`: 16 cabinets at 250 Hz after the storage fix;
  cold/concurrent timings excluded from performance claims.
- `projected-16-performance`: repeated 32.474918365478516 Hz comparison.
- Each study retains requests, validation, source snapshots/revisions/diffs,
  scene hash, complex outputs, raw events and GPU samples.

## Focused validation

The CUDA gates pass 33 compression/selected-column assertions and 19 projection
assertions, including complex arithmetic, both phasor conventions, ground and
near corrections, all supported symmetry layouts, offsets, and mixed package
ordering. Python harness tests pass (2); Ruff and whitespace checks pass.
Initial sandbox attempts hit known Windows temporary-folder / subprocess ACL
failures; successful runs use the same local environment outside the sandbox.

The one-cabinet projected result agrees with the retained Float32 CPU Deploy
reference: relative L2 errors are 5.47e-7 pressure, 1.33e-6 velocity and 8.92e-7
current. This small CPU reference is not a full-scene Float64 qualification.
The required standalone CPU reference suite also completes with exit code 0;
see `projection-reference.log` and `projection-reference-exit.json`.

At 32.474918365478516 Hz, worst relative L2 errors across the three measured
pairs are 6.91e-7 microphone pressure, 4.00e-6 transducer velocity and 3.64e-6
current. The largest independent exact preconditioned residual is 3.99e-5.
Audience plane 0 has relative L2 error 1.28e-6 and worst magnitude difference
0.000150 dB; plane 1 has 2.72e-6 and 0.000699 dB, respectively. Magnitude
comparisons use the reference peak-minus-30-dB cutoff.

At 250 Hz, the 16-cabinet comparison passes all gates:

| Quantity | Complex relative L2 error | Worst magnitude error within 30 dB of peak |
|---|---:|---:|
| Microphone pressure | 1.78e-6 | 0.0000135 dB |
| Transducer velocity | 1.41e-7 | 0.00000114 dB |
| Transducer current | 4.27e-8 | 0.000000727 dB |
| Audience plane 0 (29,415 samples) | 4.37e-6 | 0.000323 dB |
| Audience plane 1 (6,270 retained samples) | 9.35e-6 | 0.001893 dB |

The independent exact left-preconditioned residual is 8.32e-5 (gate 1e-3).
These errors include Float32 assembly and solve differences. This test has no
warm-up and is used only for accuracy, not a speedup claim.

## Limitations

Construction still integrates all relevant dense entries. Near and singular
corrections are recomputed for each cabinet slab. Projection is rebuilt on
every request, and the dense exterior matrix/factorization remains the scaling
limit. Very large individual cabinets can require smaller slabs to fit memory.
No automatic calibration or application cache integration is added.

GPU memory samples are device-wide at roughly one-second intervals, include
other applications and can miss brief peaks. Host peak memory is unavailable.
Qualification covers this package/scene at two frequencies and a one-cabinet
CPU comparison; it does not establish mesh convergence, measurement agreement,
general heterogeneous-scene performance or all-frequency accuracy.
