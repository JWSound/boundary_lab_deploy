# Contributing to Boundary Lab Deploy

Create a scoped branch or fork from `main` and open a PR back to `main`. Use draft
PRs for work in progress. Link related BEAT or Boundary Lab PRs when a change spans
repositories. There is no permanent dev branch.

Deploy must run without a Boundary Lab checkout or installation. Keep Python core
code free of Qt and use BEAT public APIs; numerical implementation belongs in BEAT.
Keep `.blabsp` compatibility fixtures and preserve complex results and provenance.

Use Python 3.11+ for development (3.13 for Windows runtime builds) and Node 20:

```sh
python -m venv .venv
# Activate .venv using your shell, then:
python -m pip install -e ".[dev]"
python -m ruff check src tests scripts
python -m pytest tests
cd desktop
npm ci
npm run build
npm run test:viewport
npm run test:placement
npm run test:pattern
npm run test:runtime
```

Most contribution checks do not need a GPU. Real coupled solves require supported
hardware and maintainer qualification. Do not commit generated installers, runtime
bundles, solver runs or node_modules. See [distribution](docs/distribution.md) and
[release process](docs/development.md).
