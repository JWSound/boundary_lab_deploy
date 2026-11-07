# Relocated ROCm candidate runtime qualification

On 2026-11-07, runtime `win-x64-df277ded33ef95c0` passed offline relocated
Deploy CPU/ROCm qualification on the Windows RX 7600 host. This extends the
[staging-only qualification](rocm-runtime-staging.md) to actual Boundary and
Coupled array workflows using a candidate engine containing the ROCm solver.

## Candidate identity

- Engine commit: `dba31dafba09381fa27eefe09b99868531fe13f2` (BEAT PR #103).
- Engine wheel: `beat_engine-0.7.0-py3-none-any.whl`, SHA-256
  `35e156fc8a8abd9c699636b9e4727c3a1d2b1740e97bb87a3f80677c87cb0660`.
- Deploy source: runtime-staging branch at `af2ee60`; the candidate builder adds
  `--runtime-lock` selection, with no changes to application solver code.
- Python 3.13.13, Julia 1.12.6, AMDGPU 2.7.2, system ROCm SDK 7.2.

The candidate lock copied the checked-in lock and replaced `beat_requirement`
with the local wheel URI and SHA-256 fragment. The builder records the selected
lock and wheel hashes in its manifest. All 224 recorded engine Python/Julia
source hashes matched the qualified engine checkout after the run.

## Qualification

The builder staged CPU/CUDA/ROCm environments from a fresh Julia depot. The
verifier relocated resources to a path containing spaces, cleared developer
Python/Julia/GPU paths and device overrides, used a fresh writable user depot,
and set offline package configuration plus unreachable network proxies.

```powershell
python scripts/build_runtime.py --include-rocm --runtime-lock runs/candidate/runtime-lock.json --output runs/candidate/resources
python scripts/verify_bundle.py --resources runs/candidate/resources --destination 'runs/candidate/Relocated ROCm/resources' --data-directory runs/candidate/relocation-user --solve --qualify-backends --backend rocm --scene mixed-close-ground
```

The ROCm smoke solve passed. The mixed S218BP_LOD/SKHORN scene passed both
Boundary and Coupled solves, retained field updates, and two-frequency sweeps
on CPU and ROCm. Coupled diaphragm velocity and coil current comparisons,
GMRES residual limits, and sweep warm starts passed the existing assertions.
The scene exercised 14,902 direct and 29,396 ground-image near pairs.

| Pressure comparison | Relative difference |
|---|---:|
| Boundary solve / first sweep frequency | 3.482925e-6 |
| Boundary retained field | 2.733422e-6 |
| Boundary second sweep frequency | 1.309625e-6 |
| Coupled solve / first sweep frequency | 2.135373e-6 |
| Coupled retained field | 3.381678e-6 |
| Coupled second sweep frequency | 2.581246e-6 |

All are below the unchanged `5e-4` comparison limit. Diagnostics confirm ROCm
rocSOLVER dense LU with Float64 factors and ROCm field evaluation; Coupled
Krylov iteration remains on CPU. The verifier exited successfully with
`qualified_backends: true` and `resources_unchanged: true`. No Julia worker
remained after qualification. These are correctness runs, not warmed timing
comparisons, and support no performance claim.

The 19 focused staging/verifier/release-tool tests, Ruff, and desktop build also
passed. Local evidence is retained in the candidate worktree under
`runs/candidate/`: `build.log`, `relocation.log`, `relocation-user/verification.json`,
`relocation-user/backends-a6cc45c1/`, `provenance.json`, and `final-audit.json`.
Results SHA-256: `058ec5b89aef3c58bae2eb19b98c4bd903bacf7763d0b1ddd8b654ebf862291f`.

## Scope

This wheel was built locally from an immutable source commit; its version
string alone does not distinguish it from the released 0.7.0 wheel. Use the
recorded hash and commit. The checked-in release lock and application dependency
still select the released engine. They were not changed by candidate testing.
This result qualifies the relocated candidate resources on this host, not an
installed Electron application, all AMD devices, or a release artifact.
