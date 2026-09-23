# Observation plane sampling

New audience planes use 2 points per meter. The inspector provides a slider and
numeric entry from 0.5 to 10 points/m in 0.1 steps. At density d, samples include
both edges: columns = max(2, ceil(width*d)+1), rows = max(2, ceil(depth*d)+1).
Spacing is therefore no greater than 1/d. The inspector shows the actual grid
and total point count. Density is per plane, while heatmap scales remain shared.

The 250,000-point ceiling is per plane and enforced before accepting density
changes or resizes, at project load, and by the existing Python solve validation.
An over-limit change leaves the prior plane intact and reports the limit; density
is never silently reduced to fit. The former project-file limit of 200 samples
per axis is replaced by the total-point limit. For a 24 x 24 m plane, 10 points/m
produces 241 x 241 = 58,081 points.

Resizing a density-based plane preserves points/m and derives a new grid. Schema
11 stores optional pointsPerMeter alongside rows/columns and validates that they
agree. Projects from versions 5-10 without density preserve their explicit grids
and former fixed-major-axis resize behavior until the resolution control is
edited. Saving those legacy planes does not resample them. Older application
versions cannot open schema 11 projects.

Changing observation density invalidates field samples while retaining eligible
solved-boundary reuse. It does not change the mesh, speaker package, or electrical
drive. New-project shared heatmap defaults are 70 dB minimum and 125 dB maximum;
existing saved scales remain unchanged.
