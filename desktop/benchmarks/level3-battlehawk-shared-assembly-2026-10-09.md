# Projected feedback: correction reuse, shared assembly and drive updates

This continues the [ROM projection spike](level3-battlehawk-projection-2026-10-09.md).
The numerical changes are opt-in BEAT Engine research modes. Deploy's desktop
defaults and saved scene/package files are unchanged.

## Fresh-solve result

At 32.474918365478516 Hz, with identical nonuniform complex drives, three warmed
interleaved repeats give:

| Mode | Median worker request | Range |
|---|---:|---:|
| Previous projection | 22.346 s | 22.174–22.487 s |
| Reused corrections | 20.403 s | 20.282–20.406 s |
| Shared assembly | 17.249 s | 17.222–17.355 s |

Shared assembly reduces fresh-request time by **22.8% (1.30× speedup)** versus
the previous projected path. Correction reuse alone saves about 1.94 s. Its
projected-operator build takes 3.568 s; shared assembly eliminates that separate
pass and assembles both operators in 7.045 s. Exterior LU remains 4.739 s.
The independent audit is included in every candidate time.

All three repeated comparisons and both audience planes pass for each mode.
The largest audience-plane magnitude difference among these comparisons is
0.000376 dB within 30 dB of reference peak. Device-wide sampled memory peaks at
8,419 MiB over this study. No other qualification solves/tests ran concurrently.

The first retained-factor implementation measured 13.543 s per update, but
profiling found 4.77–4.97 s spent serializing request settings, primarily
1,450,598 near/image-near pairs as nested objects. The final cache-key code
normalizes those pairs into contiguous Int64 arrays, preserving both indices
and the effective quadrature order. Non-numerical proximity diagnostics are
excluded. The original profile and four-mode study are retained; a separate
repeat study measures the final key implementation.

## Retained-drive-update result

The final compact-key study uses three warmed interleaved pairs with the same
nonuniform drive update:

| Path | Median worker request | Range |
|---|---:|---:|
| Fresh shared assembly | 17.063 s | 17.026–17.083 s |
| Retained-factor drive update | 9.365 s | 9.268–9.622 s |

The update uses **45.1% less time (1.82× speedup)** than its paired fresh solve.
This requires a retained entry: the separate original-drive priming requests
cost a median 18.360 s (18.291–18.405 s), excluded from update latency. All three
priming requests miss the cache, and all three changed-drive requests hit.

Median update costs include 1.163 s signature construction, 2.619 s exact new
drive RHS assembly, 2.461 s independent audit and 0.167 s GMRES. Shared Python
scene preparation takes 10.732 s outside the request timer; startup is also
outside it. Retained LU, pivots and projected operator occupy 6,385,226,112 bytes
(about 5.95 GiB). The device-wide sampled peak is 8,455 MiB over 259 samples.
No other qualification solves/tests ran during this study.

All repeated comparisons and both planes pass. Worst relative L2 errors across
the three solve pairs are 8.00e-7 microphone pressure, 2.09e-6 transducer velocity
and 1.56e-6 current. The largest independent exact preconditioned residual is
4.25e-5. Plane errors are 8.27e-7 / 1.41e-6 relative L2 and 0.0000294 / 0.000275 dB
maximum magnitude difference within the reference peak-minus-30-dB cutoff.

These results justify broader scene/package qualification next. The fresh path
still pays dense exterior assembly and LU; the update path still pays exact
drive assembly and the independent audit. Further architectural changes should
follow qualification rather than being inferred from this one package/scene.

## Implemented paths

- `projected`: the previous projection implementation, retained as a control.
- `projected_cached`: compute near/singular correction blocks once per request,
  reuse them between exterior assembly and all cabinet slabs, then release them.
- `projected_fused`: assemble regular exterior matrix entries and each cabinet's
  RHS slab in the same quadrature passes. Project the slab, accumulate its drive
  RHS, and release it. Complete exterior corrections, identity and row weighting
  once. Factor the completed exterior matrix normally.
- `projected_reuse`: use shared assembly on a miss; retain one exterior LU and
  projected operator for subsequent drive changes. On a hit, build the new exact
  drive RHS and solve against the retained factors. It does not reuse pressure
  from the previous drive.

All paths retain the independent exact-quadrature residual audit. No additional
ROM truncation is introduced. Shared assembly changes floating-point summation
order, so numerical comparisons are required.

## Cache validity and lifetime

The single-entry factor cache hashes actual loaded mesh vertices/faces and ROM
arrays, orbit/sign mappings, instance offsets, physical/discretization settings,
near-pair maps and the active phasor convention. Gain/phase drive values are
excluded. Frequency, geometry, ROM coefficients or integration changes cause
rebuilds. Hashing uses loaded values rather than trusting a caller-supplied key
or file timestamp. Changed requests load and validate their mesh/ROM inputs.
The experimental factor path rejects `retain_geometry_cache: true`; integrating
both cache contracts is future work.

A miss releases the old entry before constructing the replacement. Selecting a
non-reuse mode or clearing geometry releases retained factors. The cache retains
about 5.73 GiB of exterior LU plus the 216.75 MiB projected operator for this
scene, as well as the small pivot array. It is worker-local and not persisted.
Correction blocks are request-local and are released even when factors remain.

## Workload and measurement

Use the existing 16-Battlehawk scene at
`G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json`.
Preserve placements and package identity. The drive-update overlay applies a
different complex gain to each cabinet, updating ROM inputs and reference
boundary traces; the original file remains unchanged. This exercises a coupled
response change rather than a uniform scaling shortcut.

The comparison includes one warm-up per mode and three interleaved measured
repeats. For `projected_reuse`, a separate original-drive request primes the cache
before the changed-drive request. Priming time/results are retained separately
and are not included in update latency. A cold cache still pays construction.
Worker request times include repeated input preparation, device setup, solve,
audit and transport; shared Python scene preparation and worker startup are
outside that timer. Audience-plane evaluation follows the final repeat and is
also outside the coupled request timer.

```powershell
$env:PYTHONPATH='E:/Code/boundary_lab_deploy/src;E:/Code/BEAT_Engine/src'
python scripts/research_deploy_compression.py 'G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json' --output runs/compression-spike/optimized-performance --counts 16 --modes projected,projected_cached,projected_fused,projected_reuse --drive-update --warmup 1 --repeat 3 --field-planes
python scripts/compare_deploy_compression.py runs/compression-spike/optimized-performance --reference projected --candidate projected_fused
python scripts/compare_deploy_compression.py runs/compression-spike/optimized-performance --reference projected --candidate projected_reuse
python scripts/research_deploy_compression.py 'G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json' --output runs/compression-spike/optimized-cache-v2-performance --counts 16 --modes projected_fused,projected_reuse --drive-update --warmup 1 --repeat 3 --field-planes
python scripts/compare_deploy_compression.py runs/compression-spike/optimized-cache-v2-performance --reference projected_fused --candidate projected_reuse
```

Runtime is the same RTX 2080 Ti / Ryzen 7 5700X machine, Julia 1.12.6, Python
3.13.13, four Julia/BLAS threads. Device-wide GPU samples are approximate and
include other applications; host peak memory is unavailable.

## Retained diagnostics

Artifacts live under `runs/compression-spike/` and are not committed.

- `corrections-performance`: incomplete first measurement attempt, preserved.
  A field-only cleanup path referenced a solve-local correction cache; fixed
  before the subsequent studies. Partial timings are excluded from conclusions.
- `optimized-small-accuracy`: one cabinet with changed complex drive, fresh
  matrix-free reference, shared assembly, retained factors, and both planes.
- `optimized-upper-accuracy`: the same comparison with 16 cabinets at 250 Hz.
- `cache-frequency-invalidation`: a single worker retains one-cabinet factors
  across drive updates and rebuilds them on moving from 32.474918365478516 to
  250 Hz.
- `optimized-performance`: repeated four-mode comparison; retained updates use
  the initial nested-object signature implementation, preserved in its snapshot.
- `profile-factor-key.log`: isolated CPU breakdown identifying nested near-map
  serialization as the dominant retained-update overhead.
- `optimized-cache-v2-performance`: final compact-key comparison of fresh shared
  assembly versus primed, changed-drive updates, with three interleaved repeats.
- Source snapshots, requests, package/scene identity, complex outputs, events,
  priming results, GPU samples and comparison summaries are retained per study.

## Scope limits

This remains a single real package/scene study plus synthetic mixed-model tests.
It does not establish mesh convergence, measurement agreement, heterogeneous
scene performance or all-frequency accuracy. Dense exterior LU still sets the
large-scene memory limit. Automatic mode selection, desktop cache integration
and adaptive slab sizing are future work. The audit remains enabled throughout.

## Numerical and cache qualification

The focused CUDA gates pass 104 assertions: 37 cover complex compression,
selected-column corrections and shared exterior assembly; 67 cover projection,
mixed-model ordering and factor signatures. Matrix assembly is compared directly
for both phasor conventions, with ground/image corrections. Cache-key tests
change geometry, frequency, ROM coefficients, quadrature, correction maps and
phasor convention, while drive-only changes preserve the key. The standalone
CPU reference suite passes with exit code 0. Python replay tests pass (3).
See `optimization-qualification.json` for the final logs; failed development
test attempts remain retained separately.

The real-worker two-frequency test confirms a cold miss at both frequencies,
a hit after changing the electrical drive within each frequency, and different
factor signatures between frequencies. Both 32.474918365478516 Hz one-cabinet
comparisons pass against freshly assembled matrix-free results, including both
audience planes.

At 250 Hz with 16 cabinets and nonuniform complex drive changes, all checks pass
against the fresh matrix-free reference:

| Quantity | Shared assembly: complex relative L2 | Reused factors: complex relative L2 |
|---|---:|---:|
| Microphone pressure | 2.49e-6 | 1.21e-6 |
| Transducer velocity | 1.72e-7 | 1.42e-7 |
| Transducer current | 6.43e-8 | 6.14e-8 |
| Plane 0, 29,415 samples | 7.09e-6 | 7.07e-6 |
| Plane 1, 6,270 retained samples | 1.49e-5 | 1.35e-5 |

Worst plane magnitude differences within 30 dB of reference peak are 0.000968 dB
for shared assembly and 0.001110 dB for reused factors. These cold/concurrent
qualification runs support accuracy conclusions only, not speedup claims.
