# Speaker package compatibility fixtures

Exported by Boundary Lab commit `1619e6bef92f1cc51649909391142a41e90b05b5`
using the synthetic coupled-system builders in `tests/test_speaker_package.py`.
These are small contract fixtures, not numerical reference solutions.

- `rom-xy.blabsp`: four-sector parity ROM export.
- `rom-x.blabsp`: two-sector parity ROM export.
- `rom-legacy-extra.blabsp`: ROM with the formerly supported impedance payload.
- `exact.blabsp`: exact coupled descriptor and archived mesh members.

The corresponding export assertions remain in Boundary Lab. Deploy tests consume
these committed outputs without importing Boundary Lab or locating its checkout.
When the package contract changes, generate new fixtures with the exporter,
record its commit here, and retain fixtures for supported older formats.
