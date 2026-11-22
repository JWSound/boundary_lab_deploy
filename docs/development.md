# Development and releases

Use scoped branches from `main` and pull requests targeting `main`. Keep main
usable; a merge is not a user release. There is no permanent dev branch. Only
create maintenance branches when an older supported version needs a fix, and
bring applicable fixes back into main. Prefer squash merges for scoped PRs;
use a merge commit when preserving existing branch history during migrations.

The three repositories release independently. BEAT owns numerical implementation
and worker contracts. Boundary Lab owns design and speaker-package export.
Deploy owns deployment and its installer. Applications pin a published BEAT wheel
and SHA-256. To change both layers, link PRs, test against a uniquely versioned
engine candidate, release BEAT, then merge the application dependency update.
Never replace an existing version with different package contents.

Use patch versions for compatible fixes, minor versions for features, and document
any breaking change explicitly while versions are 0.x. Once the public API is 1.x,
use major versions for breaking changes. File-format and worker schema versions
are separate contracts; preserve old supported fixtures and test round trips.

## Scene frequency requests

In a continuous Pattern or Coupled scene, the lower and upper handles select the
response plot and sweep limits. The arrow above the track selects the observation
plane frequency anywhere in the common validated band. The project stores both
selections. Preferences sets the sweep density in points per octave (default
12). Sweeps include both limits and use equal logarithmic steps. Moving the
plane arrow leaves the response samples intact.

The active fidelity determines which package data is evaluated. Sampled Level 2
traces and legacy ROMs use a single handle on the shared discrete grid.


For a coupled field solve, pass `frequencyHz`. For a coupled microphone or
transducer sweep, pass a list in `frequenciesHz`. A scene of continuous Level 3
interiors accepts frequencies throughout the intersection of their exported
bands, including the endpoints. With a discrete ROM present, every source uses
the common discrete samples inside that band. Muted cabinets participate in
this check because exterior pressure can excite them. Explicit requests outside
the shared domain fail before BEAT solves. Omitting the sweep list uses common
discrete samples, or the shared band endpoints and in-band fallback samples for
a fully continuous scene.

Deploy negotiates native continuous Level 3 support using the worker's
`deploy_continuous_rom_versions` capability. Version 1 reads the verified model
member directly from the package. Each worker shares one decoded model across
its placements and retains up to 128 MiB of recently assembled CPU operators
and factorizations. The active solve and compact models have separate memory
requirements. Changing the frequency grid does not create a temporary binary
sweep file for these packages. Workers without this capability receive staged
operators. Discrete packages use their exported binary operators in both cases.

Level 1 uses the pattern descriptor to select delay-compensated complex pressure
interpolation. Sampled patterns constrain the scene to their recorded
frequencies. Level 2 uses the shared frequencies of the fixed boundary traces.
A Level 3 package can therefore support different frequencies at each fidelity.

## Release procedure

1. Open a release PR with matching version metadata, dependency pins and
   `docs/releases/VERSION.md`. Engine versions also live in its package
   `__init__.py`; Deploy versions also live in both npm manifest/lock files.
2. Merge after required checks succeed. Wait for successful **push CI on main**
   for that exact merge commit, then create and push tag `vVERSION`.
3. Dispatch the Release candidate workflow with that existing tag. It validates
   metadata and main CI, builds and checks the package, and creates a draft release
   with artifacts and SHA256SUMS.txt. Existing releases are never overwritten.
4. Download and test the final artifacts. Complete relevant CPU/GPU and application
   integration qualification. Record exact artifact hashes and outcomes in release
   notes. Publish the draft only after qualification; mark `rcN` releases as
   prereleases and do not make them latest stable. A failed candidate receives a
   new version/tag after fixes, never a rewritten published tag.
5. Enable GitHub release immutability; complete all assets before publication.
   Application dependency adoption happens in separate PRs and on its own schedule.

Release signing credentials belong in the GitHub `release` environment. Untrusted
PRs run on hosted runners without release secrets. GPU qualification stays a
maintainer-triggered workflow on trusted hardware. Do not run arbitrary fork code
on persistent self-hosted machines.

Main is protected with required CI and PR review for contributors. The owner can
merge their own PR after checks without a second maintainer; this exception is
visible in GitHub history. Do not bypass failing checks. Resolve PR conversations
and delete completed topic branches.

## Deploy desktop candidates

Run `Desktop candidate` with an existing tested tag and `signed=false` for an
unsigned Actions test artifact. This does not create or publish a GitHub release.
Signing is not configured yet. Configure environment `release` secrets
`WIN_CSC_LINK` (electron-builder certificate URL or base64 PFX) and
`WIN_CSC_KEY_PASSWORD` before selecting `signed=true`. Never store certificates in Git.
Signed builds verify Authenticode and create a draft only. Both modes verify
runtime relocation and actual installation, launch and uninstall on Windows.
Run the offline coupled-solve qualification on trusted NVIDIA hardware against
the installed resources before publishing. The hosted runner does not validate
CUDA numerical execution. Record its runtime ID, hashes and solve residual.

Offline benchmark and ROM utilities are documented in [developer tools](developer-tools.md).

The Apple-silicon unsigned DMG builder and installed CPU/Metal qualification are
documented in [macOS packaging](macos.md#unsigned-apple-silicon-test-package).
The separate `macOS unsigned candidate` workflow produces Actions test artifacts
from tested main commits. It does not sign, notarize, or publish releases.

## Scene navigation and local asset libraries

The desktop workspace keeps the Scene/Channels pane above a persistent Assets
browser. Drag the divider (or use its Up/Down keys) to resize the panes. Assets can
be collapsed. Scene groups organize objects without changing their transforms;
create a group from the selection, double-click a name to rename it, and drag
objects onto a group to move them. Shift-click selects a range; Ctrl/Cmd-click
adds or removes individual objects. The Actions menu offers duplication, framing,
group moves, channel assignment, and deletion. Dedicated microphone and audience
plane buttons sit above the outliner. Speaker and rigid-mesh imports are handled
only in the Assets browser. Older visibility/lock flags are ignored when loading
projects; all objects remain visible and selectable.

The default desktop library is `Documents/Boundary Lab Deploy/Library`. Choose a
different folder through Assets → Import → Choose library folder. While a project
is open, Deploy rescans this folder and its subfolders every four seconds, caching
unchanged metadata. `.blabsp` packages and Gmsh `.msh` assets appear alongside
built-in examples and project assets. Search, location filters, favorites, and
recently used sorting are available. Large catalogs render a window of rows.

- **Import to library** or drop files onto Assets: copy files into the chosen
  folder, preserving the originals and avoiding overwrite on filename collisions.
- Use `+` on an asset or drag an asset row onto the viewport: add scene instances
  using the existing collision-aware placement logic, not the mouse's world point.
  External files must first be imported through Assets.
- Select an asset row to inspect its details without changing scene frequency or
  loading its full acoustic data. Use `+` to add an instance.

Desktop assets are pinned to a SHA-256-addressed cache under the application's
user-data directory. Solves and saved project references use this immutable copy.
Replacing or deleting a watched file therefore does not silently alter an open
project. A changed source is marked **Update**; its details offer **Apply to
project**. The update preserves instance identity and is rejected if new geometry
would violate boundary clearance. Undo restores the prior asset version. Copy to
library is available for project assets. Invalid files produce per-file messages.

Project schema 12 adds scene organization and optional asset origin/fingerprint
metadata; schemas 5–11 still load. When moving projects to another computer, retain
the source packages: the existing Locate dialog resolves missing cached assets and
checks the saved fingerprint. Cancelling that dialog leaves the project unopened;
placeholder objects for unresolved packages are not yet supported. Browser mode
supports project-local file imports and drops, without a persistent folder catalog.

Navigation checks:

```bash
cd desktop
npm run test:navigation
npm run test:navigation-ui
npm run test:editing-ui
```

The Electron UI tests use isolated fixtures and record screenshots under
`desktop/node_modules/.tmp`. On environments that set `ELECTRON_RUN_AS_NODE`, unset
it when launching Electron tests.
