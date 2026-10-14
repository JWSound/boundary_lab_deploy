# Deploy application icon

The ICO and ICNS are the approved application artwork. The matching PNG lives in
`../public/deploy-icon.png` for the window, project screen, editor header, and favicon.

The image is a Boundary Lab Deploy coupled CUDA observation plane: two in-phase
S218BP_LOD subwoofers, 6 m apart, at 63.041343688964844 Hz above rigid ground.
The plane samples x=-12…12 m, z=-10…14 m at y=2 m on a 241 × 241 grid.
It uses Deploy's heatmap palette with a 70–106 dB range and rounded transparent
corners. The macOS icon includes a 10% transparent inset.

The original study and reproduction scripts remain local under
`runs/icon-design` and `runs/icon-design-cuda`; solver outputs are not shipped.
