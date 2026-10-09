# CUDA ROM projection: broader scene qualification

This study extends the original 16-Battlehawk experiment with controlled scenes
derived from that saved project and its two actual exported speaker packages.
These are reproducible research fixtures, not three independently authored
customer scenes. Source projects and package contents remain unchanged.

## Coverage

| Fixture | Cabinets | Placement |
|---|---:|---|
| Battlehawk stack | 8 | First eight sources in the original scene; original close spacing, ground relationship and alternating rolls |
| S218BP spaced array | 4 | X/Z corners at -2/+2 m, center height 2 m, yaw 0/45/90/135 degrees |
| Mixed array | 4 | Alternating S218BP/Battlehawk at the same corners; heights 2/2.25/2.5/2.75 m, alternating pitch +/-10 and roll +/-20 degrees |

Each fixture uses common exported frequencies 20, 99.78462982177734 and 250 Hz.
Battlehawk has two parity sectors and one electrical input; S218BP has four
sectors and two electrical inputs. Both retain 32 coordinates per sector.
The mixed case exercises heterogeneous geometry, sector counts, input counts
and interleaved model instances through the actual public worker.

Every case compares `matrix_free`, `projected_fused` and `projected_reuse` with
the same deterministic nonuniform complex drive overlay. Reuse is primed with
the original drive, then tested after changing the drive. Five pressure probes
cover different positions/heights, and both saved field planes are retained
at a reduced 31-by-31 sampling grid (below-ground samples remain excluded).
The source/channel DSP and original plane extents/orientations are preserved.

This is **accuracy qualification only**: one measured comparison per case,
without performance warmups. CPU reference and bundle validation may run
concurrently. Timings in raw artifacts must not be used for speed claims.
The prior three-repeat performance reports remain the performance evidence.

## Results

All nine scene/frequency cases pass for both shared assembly and retained-factor
updates: 18 candidate comparisons, each including both planes. The planes have
961 and 527 retained samples respectively. Every original-drive prime is a
cache miss; every changed-drive update is a hit with the same factor signature.

The table gives worst errors across all three frequencies and both candidates.

| Fixture | Probe pressure relative L2 | Velocity relative L2 | Current relative L2 | Plane relative L2 | Plane magnitude error |
|---|---:|---:|---:|---:|---:|
| Battlehawk stack | 4.78e-6 | 9.69e-7 | 8.91e-7 | 4.86e-6 | 0.000328 dB |
| S218BP spaced array | 1.47e-6 | 1.78e-6 | 1.90e-6 | 2.19e-6 | 0.000174 dB |
| Mixed rotated array | 4.27e-6 | 1.34e-6 | 1.30e-6 | 3.78e-6 | 0.000239 dB |

The largest independent exact left-preconditioned residual is 9.683e-5,
below the 1e-3 audit limit. These results support continuing the exact-ROM
optimization path beyond the original scene; they do not justify enabling it
by default yet.

Engine numerical source is commit `18d0d98`; the later `b1c0519` changes only
bundle dependency declarations. Deploy replay source is `6f0391d` plus the
fixture generator. Hardware/runtime match the earlier Battlehawk reports.

The additional one-cabinet S218BP lifecycle test passes in one persistent
worker: original geometry primes once, a changed drive hits, a +0.375 m X
translation and +17 degree yaw change misses, its repeat hits, then changing
99.78462982177734 Hz to 250 Hz misses and the repeat hits. All three signatures
are distinct, and all retained solutions agree with fresh matrix-free solves.
At 99.78462982177734 Hz the independent CPU comparison passes with relative L2
errors 2.47e-6 pressure, 2.59e-6 velocity and 2.77e-6 current (five probes).

PR CI exposed missing SHA/Serialization declarations in the driver bundle
packages, which source-mode tests did not exercise. Those standard-library
dependencies are now declared in CPU/CUDA/Metal/ROCm driver bundles and their
manifests; the local CPU bundle import passes. Numerical source is unchanged.

## Reproduction

Use the engine performance PR and this Deploy checkout with both `src`
directories on `PYTHONPATH`. Generate local fixtures with:

```powershell
$env:PYTHONPATH='E:/Code/boundary_lab_deploy/src;E:/Code/BEAT_Engine/src'
python scripts/make_deploy_qualification_scenes.py 'G:/My Drive/Projects/Boundary Lab Projects/largebattlehawkscene.blabdeploy.json' --output runs/qualification-fixtures
```

For each entry in `matrix.json`, use its scene path and cabinet count:

```powershell
python scripts/research_deploy_compression.py SCENE --output STUDY --counts COUNT --frequencies 20,99.78462982177734,250 --modes matrix_free,projected_fused,projected_reuse --drive-update --warmup 0 --repeat 1 --field-planes
python scripts/compare_deploy_compression.py STUDY --candidate projected_fused
python scripts/compare_deploy_compression.py STUDY --candidate projected_reuse
```

For the additional CPU reference and factor lifecycle check, use the secondary
fixture as `SCENE` and the resulting CPU solve JSON as `CPU_RESULT`:

```powershell
python scripts/research_deploy_compression.py SCENE --output CPU_STUDY --counts 1 --frequencies 99.78462982177734 --backend cpu --modes matrix_free --drive-update --warmup 0 --repeat 1 --field-planes
python scripts/qualify_deploy_factor_cache.py SCENE --output CACHE_STUDY --frequency 99.78462982177734 --next-frequency 250 --cpu-result CPU_RESULT
```

The comparison command writes `comparison.json`; save each candidate's result
before running the next comparison. Require all complex pressure/current/velocity
relative L2 errors below 1%, magnitude differences below 0.1 dB within 30 dB of
reference peak, GMRES residuals at most 1e-4 and the independent exact
left-preconditioned residual audit at most 1e-3. Check that each reuse prime is
a miss and the changed-drive solve is a hit with the same signature.

Raw scenes, payload validation, source snapshots, requests, events, complex
outputs and GPU memory samples are retained under
`runs/scene-qualification-2026-10-09/` and excluded from the repository.
The fixture generator was checked against the actual study inputs; generated
scene contents match after normalizing path spelling and fixture names.

## Scope limits

This qualifies agreement with the existing solver for the sampled exported
ROMs. It does not establish mesh convergence, ROM accuracy against a full
interior model, measurement agreement, all-frequency coverage, rigid-object
support, larger-scene memory behavior, or desktop cache lifecycle behavior.
All acceleration modes remain explicitly selected experiments.
