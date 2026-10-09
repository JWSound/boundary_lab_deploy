#!/bin/sh
set -eu
deploy_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export DEPLOY_PYTHON_EXE="${DEPLOY_PYTHON_EXE:-$deploy_root/.venv/bin/python}"
if [ ! -x "$DEPLOY_PYTHON_EXE" ]; then
    echo "Create the Deploy virtual environment first; see README.md." >&2
    exit 1
fi
unset ELECTRON_RUN_AS_NODE
cd "$deploy_root/desktop"
exec npm start
