# Coupled solving performance

Observation planes share a solved boundary state. The renderer includes processed
source drives in its solution identity; the Python worker independently hashes
all physics inputs and fingerprints package/rigid-mesh files. Changing gain,
delay, polarity, mute, channel processing, frequency, geometry, fidelity or an
asset invalidates reuse. Plane dimensions, placement and sample counts do not.
Sweeps and unsuccessful jobs invalidate the worker's solved-state identity.
The engine also checks its retained solution key before evaluating a field.

Worker completion is emitted only after temporary files and active-job state have
been cleaned up, allowing consecutive plane requests without artificial delays.

Preparation keeps one bounded proximity-map cache. Its key includes transformed
vertices, triangles, component identities/offsets, asset fingerprints and all
spacing/correction settings. Cache hits still rebuild frequency-dependent drives
and validate the other request inputs. Returned proximity lists are independent
copies, so modifying a returned request cannot contaminate the cache. Mixed ROM
models share read-only boundary data while building their own metadata, and only
the final scene request is serialized.

## Engine integration

The numerical feedback optimization lives in BEAT Engine, not Deploy. The
preparation and plane-reuse changes work with the currently pinned BEAT 0.2.0.
The additional operator-caching gains require an engine version containing that
optimization. Release builds must consume a published engine version and update
the dependency pin through the normal release process. An editable engine
checkout can be used for local development; it is not a released installer.

BEAT's automatic feedback policy measures operator build/application costs and
checks GPU memory before reusing a per-frequency DP0-to-P1 mapping. It retains
the matrix-free fallback. No mesh fidelity, quadrature order or solve tolerance
is reduced.

## Qualification: symmetry2026, 2026-09-22

Windows 11, Ryzen 7 5700X, RTX 2080 Ti (11 GiB), Julia 1.12.6 with 16 Julia/BLAS
threads and Python 3.13.13. The scene has 12 cabinets (8 S218BP and 4 SKHORN),
13,448 boundary nodes, 26,848 faces and one 22,600-sample observation plane.
Timings are persistent-worker round trips, excluding GUI rendering.

| Warm workload | Original | Deploy changes only | Deploy and BEAT changes |
| --- | ---: | ---: | ---: |
| Full solve at 81.36 Hz | 13.372 s | about 7.8 s | 4.135 s |
| Preparation for that solve | 5.688 s | about 0.45 s | 0.478 s |
| Plane-only update | Full solve | Cached field evaluation | 0.357 s |
| 100-frequency response sweep, 20-250 Hz | 609.388 s | Not separately measured | 233.162 s |

Original and combined full-solve figures are medians of three warmed repeats;
the combined range was 4.003-4.649 s. Sweep figures are one clean warmed pass
after a complete first sweep. There are no microphones, so the sweep returns
speaker/transducer responses and evaluates only a dummy field point, not 100
full heatmaps. The updated worker includes cleanup before completion, whereas
the original harness waited separately after completion.

Repeated cached planes matched unchanged-plane results exactly. A moved plane
agreed with a fresh solve to 6.7e-7 relative complex-pressure error. Gain changes
and a post-sweep plane request correctly required full solves. The full updated
sweep agreed with the original at 1.23e-6 relative transducer-velocity error;
speaker voltage matched exactly. No solver tolerances were relaxed.

The project/packages and raw profiles are local study artifacts, not portable
test fixtures. The checked-in tests cover identity invalidation, consecutive
jobs, cached-data isolation and changed-geometry validation.
