# Windows ROCm runtime staging qualification

The `--include-rocm` builder path was exercised on the Windows RX 7600 host
on 2026-11-05. It stages CPU/CUDA plus the engine's pinned ROCm environment,
AMDGPU packages, compiler artifacts and device bitcode from a fresh Julia depot.
The runtime manifest declares the staged backends and the external system SDK
dependency. Both build and relocation verification reject missing declared
ROCm compiler assets.

## Completed checks

- All 19 focused staging, bundle-selection and release-tool tests passed.
- Ruff passed for `src`, `tests` and the changed Python build/verifier scripts.
- The desktop TypeScript/Vite build passed.
- The real Windows runtime builder completed using Python 3.13.13, Julia 1.12.6
  and the unchanged release lock, producing runtime `win-x64-2ee25740a929363c`.
- A relocated copy under a path containing spaces passed the offline CPU smoke
  solve. The verifier confirmed all packaged resources remained unchanged.
- A separate probe used the relocated Julia/ROCm environment, a fresh writable
  depot and temporary directory, sanitized developer paths, offline Julia package
  settings and unreachable HTTP/HTTPS proxy endpoints. Float32 GPU computation
  and a ComplexF64 dense solve passed; the dense solve had zero relative L2
  difference against the CPU reference for the probe's two-by-two system.
- A subsequent verifier run confirmed packaged resources were still unchanged
  after the GPU probe.

## Observed dependency discovery

| Dependency | Observed location |
|---|---|
| HIP | System ROCm 7.2 `bin/amdhip64_7.dll` |
| rocBLAS | System ROCm 7.2 `bin/rocblas.dll` |
| rocSOLVER | System ROCm 7.2 `bin/rocsolver.dll` |
| Linker used by this probe | System ROCm 7.2 `bin/ld.lld.exe` |
| Device bitcode | Relocated depot artifact `0a0cad46b7dacc66387ed19e8c0f45b097f46691` |

The AMDGPU LLVM fallback artifact was staged and inventory-checked, but this
probe selected the system linker; it does not prove fallback-linker execution.
HIP, BLAS, solver libraries and the GPU driver are external dependencies, not
redistributed by the staging option.

## Qualification boundary

The later [candidate runtime qualification](rocm-candidate-runtime.md) passes
relocated Boundary/Coupled CPU/ROCm workflows with a locally built, hashed engine
wheel. The original release-lock results below retain their narrower scope.

The lock still selects BEAT v0.5.1. That wheel has a ROCm environment but lacks
Deploy's native ROCm solve implementation. These checks establish runtime staging,
relocated CPU execution and basic offline AMD dependency/compute operation on
this host. They do not qualify Deploy Boundary/Coupled ROCm workflows in an
installed application, every AMD GPU, or an AMD release.

A qualified immutable engine artifact containing the Deploy ROCm implementation,
a separate release-pin update, and full relocated/installed CPU–ROCm numerical
qualification remain required. No release pin was changed and no installer was
installed or published by this work.

Local evidence is under `runs/` in the staging worktree:
`rocm-runtime-build-r2.log`, `rocm-relocation-cpu.log`,
`rocm-relocation-user/verification.json`, `offline-rocm-probe/`, and
`rocm-post-probe-user/verification.json`. The runtime manifest contains the full
file inventory and wheel hashes. Generated artifacts remain untracked.
