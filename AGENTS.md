# Deploy agent guide

Deploy is independent of Boundary Lab. Do not import `blab` or reach into another checkout.
Keep reusable Python code Qt-free. Numerical solver implementation belongs in BEAT Engine.
Use its public worker and path APIs, preserving complex results and provenance.
Run focused pytest tests and `python -m ruff check src tests`; build the desktop with npm.
Do not commit virtual environments, node_modules, solver runs, or generated artifacts.
